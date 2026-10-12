# Security

What protects Stake-Sync, and what you still have to do when deploying.

## Money and keys

- **Stake-Sync never holds anyone's money or keys.** Every person signs with their own wallet;
  local currency goes through licensed on-ramps straight to and from that wallet.
- **Escrowed money can only move under the program's rules.** No admin, backend or database
  change can redirect it. The admin escrow page is read only.
- Server keys (`PLATFORM_SECRET_KEY`, `VERIFIER_SECRET_KEY`) can't take funds either: the
  platform key pays fees and rent top-ups, and the verifier key records results. Keep only a
  little SOL in the platform wallet, and move both to a KMS/HSM before launch.

## Accounts and sessions

| Threat | Defence |
| --- | --- |
| Password guessing | Account locks for `LOGIN_LOCK_MINUTES` after `MAX_LOGIN_ATTEMPTS` failures; the owner is emailed; rate limits on every auth route |
| Finding which emails have accounts | Sign-in takes the same time either way and gives the same answer; password reset never says whether an account exists |
| Weak passwords | 8+ characters, common-password list, no email address inside (NIST guidance) |
| Stolen refresh token | Tokens rotate on every refresh; reusing an old one ends the session and is logged |
| Signed-out or suspended people with a live token | Every request checks the session and account (cached 15 seconds) |
| Forged or tampered tokens | HS256 only (`alg: none` and algorithm swaps rejected), issuer checked |
| Admin account takeover | Separate admin sign-in, two-step verification required (`ADMIN_REQUIRE_2FA`), each code works once, 1-day admin sessions, optional `ADMIN_IP_ALLOWLIST` |
| Abused admin power | Roles with least privilege, four-eyes approval for high-impact actions, append-only audit log |
| Wallet signature replay | Messages name the site, carry a single-use nonce and expire in 10 minutes |
| Open redirect after OAuth | Only same-site paths are accepted |
| One person, many accounts | Sybil signals (shared devices, networks, funding wallets, reused proof), one external account per identity |

## Requests and data

- **Security headers** on every response (helmet): no framing, no sniffing, HSTS, a CSP that
  allows nothing.
- **Strict input**: unknown fields are rejected, every body is validated, and challenge
  verification settings go through an allow-list (a repo name can't reach other GitHub API
  paths). JSON bodies are capped at 1 MB.
- **Uploads**: images only, size-capped, rejected above 40 megapixels (decompression bombs),
  and always re-encoded, which strips hidden payloads and location metadata.
- **SQL**: all queries are parameterised.
- **Webhooks** (Onramper) are accepted only with a valid HMAC-SHA256 signature over the exact
  bytes received, compared in constant time. Bad signatures are refused and logged without the
  body. Repeats are stored once, and a completed top-up is never reversed by a later event.
- **Rate limits** per signed-in person, or per IP when signed out. `TRUST_PROXY` must match your
  hosting so `X-Forwarded-For` can't be spoofed.
- **Slow clients** are dropped (20 s for headers, 60 s per request); socket messages are capped at 64 KB.
- **Errors** never show stack traces or internals. People get a plain message and a reference
  that matches the error log.
- **Secrets at rest**: OAuth tokens and admin 2FA secrets are encrypted (AES-256-GCM); refresh
  tokens and single-use tokens are stored only as hashes.
- **Logs never contain secrets**: passwords, tokens, codes, signatures and keys are redacted.

## Server and error logs (admin app)

- **Server log**: every request (method, path, status, time, person, IP), app messages and
  warnings, and security events (failed and locked sign-ins, reused tokens, bad signatures,
  blocked admin access, rate-limit hits).
- **Error log**: exceptions grouped by cause, with counts, people affected, a stack trace and
  the requests where they happened. Resolve one, and it reopens if it comes back.
- Visible to Super admins and Risk analysts only (they include IP addresses). Kept 14 / 30 / 90
  days for info / warnings / errors (`LOG_KEEP_*`).

## Before going live

1. Set `NODE_ENV=production`. The API refuses to start without a strong `JWT_SECRET`, an
   `ENCRYPTION_KEY`, https `APP_URL`, real `CORS_ORIGINS` and `DB_SYNC` off.
2. Put it behind HTTPS and set `TRUST_PROXY` to the number of proxies in front.
3. Every admin enrolls in two-step verification on first sign-in. Consider `ADMIN_IP_ALLOWLIST`.
4. Move the verifier and platform keys to a KMS/HSM; make the program's upgrade authority and
   admin a multisig (Squads).
5. Get the Solana program audited before it holds real value.
6. Run `npm audit --omit=dev`. The remaining advisory (`bigint-buffer`, via the Solana token
   library) has no patched release; the backend doesn't call the affected function, and
   `uuid`, `stream-json` and `toml` are pinned to patched versions through `overrides`.
7. Back up the database and keep the backups encrypted.
