# Local currency with LocalRamp

LocalRamp (https://docs.localramp.co) lets people pay in naira (and GHS, KES, XOF, XAF, RWF, ZMW)
and receive USDC in their own wallet, or sell USDC back to a bank account (NGN, GHS, KES, XOF, XAF,
UGX, ZMW). Stake-Sync pays no partner fee; the person pays LocalRamp's processor fee and rate, which
LocalRamp shows before they pay. It is the default provider as soon as `LOCALRAMP_PUBLIC_KEY` is
set; Onramper stays available with `ONRAMP_PROVIDER=onramper`.

## Setup

1. Create a merchant account at https://merchant.localramp.co/auth/signup. LocalRamp's business team
   gets in touch to activate it.
2. From the dashboard's API settings, set:
   - `LOCALRAMP_PUBLIC_KEY` (`pk_live_…`): sent to the app for the pop-up.
   - `LOCALRAMP_SECRET_KEY`: server only, for status checks. Never sent to the app.
3. Webhooks: in the dashboard, set the URL to `{API_URL}/api/payments/onramp/localramp/webhook`
   and choose a long random token; put the same value in `LOCALRAMP_WEBHOOK_TOKEN`
   (`openssl rand -hex 24`).
4. Confirm the coin codes for USDC on Solana with `GET https://api.localramp.co/v1/transaction/buy/currencies`
   (header `x-auth-token: <public key>`). The defaults are `LOCALRAMP_BUY_CURRENCY=USDC_SOL`,
   `LOCALRAMP_SELL_CURRENCY=USDC`, `LOCALRAMP_SELL_CHAIN=SOL`; change them if LocalRamp's differ.

## How it works

- `POST /api/payments/onramp` creates a random session reference (`ss_…`) and returns the pop-up
  settings (`provider: "localramp"`, script URL, `LocalRampBuy`/`LocalRampSell`, options). The app
  loads LocalRamp's script and opens the pop-up; only the public key leaves the server.
- LocalRamp's webhooks (`buy.fiat_received`, `buy.crypto_sent`, `sell.completed`, `sell.failed`) are
  checked against the token in constant time, translated to the same shape as Onramper's events
  (`src/modules/payments/localramp.ts`), and run through the same pipeline: stored first, status only
  moves forward, a completed top-up is confirmed by reading the USDC credit on-chain, one money-history
  row per transaction, and one notification per state.
- When the pop-up closes, the app calls `POST /api/payments/onramp/:reference/check`; the API asks
  LocalRamp for the status with the secret key (only for the caller's own session) and records it.
- Cash-outs follow `ONRAMPER_SELL_WEBHOOKS_ENABLED` like Onramper's: recorded only once that's on.

## Differences from Onramper

- Webhooks are authenticated with a fixed token header, not a per-message signature. Keep the token
  long and secret, and rotate it in both places if it leaks.
- LocalRamp's payloads carry no timestamp, so the time we receive an event is used as its status time.
- `sell.initiated` only carries LocalRamp's own reference, so it's acknowledged and not recorded; the
  cash-out appears when `sell.completed` or `sell.failed` arrives.
