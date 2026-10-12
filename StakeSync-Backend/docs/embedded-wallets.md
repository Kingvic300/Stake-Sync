# Embedded wallets (Privy)

People new to crypto get a Solana wallet created for them, protected by their Stake-Sync sign-in.
Privy holds the key in an isolated frame on its own domain; Stake-Sync never sees it, can't move
the money, and the person can export the key to any wallet app at any time. Free on Privy's
developer plan (about 500 monthly active users; check privy.io for current limits).

## How sign-in works (no second login)

1. The member app asks our API for a wallet token: `POST /api/auth/wallet-token` (signed-in only).
   It's an ES256 JWT, valid 10 minutes, with `sub` = the Stake-Sync user ID.
2. Privy verifies it against our public key at `GET /api/auth/wallet-token/jwks.json`.
3. Privy signs the person in to their wallet. Wallet tokens can't be used on our own API, which
   only accepts its HS256 session tokens.
4. When they create the wallet, it's linked to their account by signing a one-time message,
   exactly like a Phantom wallet (`kind: 'embedded'`).

## Setup

1. Create an app at dashboard.privy.io. Copy the **App ID**.
2. Request access to **Custom authentication** (Integrations > Built-in), then open
   User management > Authentication > JWT and set:
   - Authentication environment: **client-side** (the member app talks to Privy directly).
   - JWKS endpoint: `{API_URL}/api/auth/wallet-token/jwks.json`
     (for example `https://api.stakesync.app/api/auth/wallet-token/jwks.json`).
   - JWT ID claim: `sub`.
3. In Privy, turn off its own login methods (email, social) so the only way in is our token, and
   add your app domains (e.g. `https://stake-sync-ui.vercel.app`) to the allowed origins.
4. Backend: set `WALLET_AUTH_PRIVATE_KEY` (EC P-256 PEM). Generate with
   `openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt`.
   Keep it stable: changing it signs everyone out of their wallets until Privy refetches the JWKS.
5. Member app: set `VITE_PRIVY_APP_ID` and redeploy.

Without `VITE_PRIVY_APP_ID`, the app asks people to connect their own wallet (Phantom, Solflare,
Backpack) instead. If Privy can't sign someone in within 12 seconds, the app says so and offers
the same fallback.
