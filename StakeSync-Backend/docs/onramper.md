# Onramper: local currency in and out

People add money with cards, bank transfers or mobile money, and cash out to their bank, through
[Onramper](https://docs.onramper.com). Licensed on-ramps do the conversion, and USDC goes straight
to and from the person's own wallet. Stake-Sync never holds it.

Two parts:

1. **Widget links** (`POST /api/payments/onramp`). This works with only `ONRAMPER_API_KEY` and
   `ONRAMPER_SIGNING_KEY`. Each link is signed with Onramper's V2 scheme and gets its own random
   `partnerContext` (`ss_…`), saved in `onramp_sessions` with the person, wallet and mode.
2. **Webhooks** (`POST /api/payments/onramp/webhook`). These record top-ups (and later cash-outs) in
   money history and notify the person. They're **off** until you turn them on.

The wallet balance always comes from the chain. Webhooks only explain where money came from or went.

## Turning webhooks on

1. Ask your Onramper Customer Success Manager to register
   `{API_URL}/api/payments/onramp/webhook` for your API key. Do this separately for staging and
   production. They give you a secret for each.
2. Set `ONRAMPER_WEBHOOK_SECRET` to that secret and `ONRAMPER_WEBHOOKS_ENABLED=true`. In production
   the API refuses to start with webhooks on and no secret.
3. Do a staging purchase (`buy.onramper.dev` with a `pk_test_` key) and check that the event shows up
   in `onramp_events` with `outcome = 'applied'`. Then check the money-history entry.

| Variable | Default | |
| --- | --- | --- |
| `ONRAMPER_WEBHOOKS_ENABLED` | `false` | Accept and process webhooks |
| `ONRAMPER_WEBHOOK_SECRET` | none | Required once webhooks are on |
| `ONRAMPER_SELL_WEBHOOKS_ENABLED` | `false` | Record cash-outs. Leave off: see below |
| `ONRAMPER_RECONCILE_ENABLED` | `false` | Ask Onramper's API about unfinished transactions. Leave off: see below |
| `ONRAMPER_API_URL` | `https://api.onramper.com` | `https://api-stg.onramper.com` for staging. Used only by reconciliation |

## How a webhook is handled

1. **Authenticated.** `X-Onramper-Webhook-Signature` must be the HMAC-SHA256 hex digest of the exact
   bytes received, keyed with the secret. It's compared in constant time. Anything else gets a 401,
   is logged as a security event (never with the body or header), and is not stored.
2. **Stored before processing** in `onramp_events`, deduplicated by a hash of the body, then
   answered with 200. We don't rely on Onramper retrying, because its retry policy isn't documented.
3. **Processed:**
   - **Owner:** the `partnerContext` finds the session. A buy must go to the session's wallet.
     Links from before sessions existed carried the user id; those count only for buys into that
     person's own linked wallet.
   - **Type and status:** `buy`/`onramp` mean a buy and `sell`/`offramp` mean a sell. These are
     every spelling Onramper's docs use. The statuses are `new`, `pending`, `paid`, `completed`,
     `failed` and `canceled`.
   - **Direction check:** USDC (`ONRAMPER_USDC_ID`) has to be on the side the direction says it is.
   - **Parking:** anything unknown or unattributable is **parked**, with the payload kept, instead
     of being guessed.
4. **Status changes only move forward** (`decideTransition` in `onramp-mapping.ts`):
   - **Repeats and stale events:** repeats are ignored, and older steps that arrive late are marked stale.
   - **Completed is final:** a completed transaction is never reversed. A later failure goes to
     review (`onramp_transactions.review_reason`).
   - **Completed after failed:** this is applied only if we read the USDC credit on-chain ourselves
     (`chain_verified`). Otherwise it goes to review. Onramper's own examples show this sequence,
     so it can't simply be refused.
5. **Money history:** one `ledger_entries` row per transaction (`kind` `added` or `cashed_out`,
   `ref` `onramper:<transactionId>`), updated in place:
   - **Statuses:** `new` isn't shown, `pending`/`paid` show as pending, `completed` as confirmed, and
     `failed`/`canceled` as failed.
   - **Abandoned widgets:** one that was opened and canceled is never shown.
   - **Failures:** these keep Onramper's `statusReason` and tell the person what to do next. They
     never claim a refund, because Onramper documents no refund status.
6. **Notifications:**
   - **What's sent:** "money added" for completed buys, and a `problem` notification only when a
     payment was taken but the purchase failed.
   - **Rules:** the usual preferences apply, including email only if the person turned email on.
     Each transaction and state is notified at most once.
   - **Failures:** if sending fails, `notified_state` stays behind and the retry job sends it later.

Failed processing is retried every minute with backoff, up to 10 times (`attempts`, `last_error`).
To reprocess parked events once their cause is fixed, run
`UPDATE onramp_events SET processed_at = NULL, attempts = 0 WHERE outcome = 'parked' AND …`.

## Still off, and why

- **Cash-outs** (`ONRAMPER_SELL_WEBHOOKS_ENABLED`). Onramper's webhook docs describe the fields only
  for buys, and their two pages disagree on the sell type (`sell` vs `offramp`). The mapping here
  (USDC in `inAmount`/`sourceCurrency`, fiat in `outAmount`/`targetCurrency`) comes from the offramp
  redirect docs. The following need confirming with real sell payloads first:
  - which status means the bank payout happened;
  - whether `walletAddress` is the person's wallet or the provider's.

  A cash-out paid with our own `POST /payments/send` is folded into that send's history row, but
  only once the webhook carries the transaction hash. Until then, sell events are parked (and kept).
- **Reconciliation** (`ONRAMPER_RECONCILE_ENABLED`). This calls `GET /transactions/{id}` with the API
  key and the webhook secret (`x-onramper-secret`), as Onramper's API reference describes. It's off
  until that authentication and the response shape have been tested against real transactions.
