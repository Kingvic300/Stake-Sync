# Stake-Sync API

Backend for Stake-Sync: verified commitment challenges with USDC stakes held in a Solana escrow
program. NestJS 12, TypeORM, PostgreSQL.

- **Escrow program:** `ANKCFRDYu45J199F1teNEeCiRUC7xYRArMtiHRYkvAcV` ([StakeSync-SmartContract](https://github.com/Kingvic300/StakeSync-SmartContract)).
- **Solana integration:** [docs/solana-integration.md](docs/solana-integration.md).
- **Verification providers** (all usable on free tiers): [docs/verification-providers.md](docs/verification-providers.md).
- **Security** (what's in place, how to deploy safely): [docs/security.md](docs/security.md).
- **Local currency in and out**: LocalRamp by default ([docs/localramp.md](docs/localramp.md)), or Onramper ([docs/onramper.md](docs/onramper.md)).
- **Download my data** (`GET /me/export`): [docs/data-export.md](docs/data-export.md).

## Run it

```bash
npm install
cp .env.example .env            # fill in DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY at minimum
npm run build && npm run start:prod   # runs migrations on boot
```

A local database for development:

```bash
docker run -d --name stakesync-pg -p 5432:5432 -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=stakesync postgres:16
# DATABASE_URL=postgresql://postgres:dev@localhost:5432/stakesync
```

What works without which keys:

| Feature | Needs |
| --- | --- |
| Accounts, challenges without money, verification, chat, orgs, admin | Nothing extra |
| Emails | `BREVO_API_KEY` (Brevo, free 300/day) and a verified `MAIL_FROM`; otherwise links are logged |
| Google, GitHub, WakaTime connections | Their OAuth client id and secret |
| Staking, sponsoring, claims, escrow | `PLATFORM_SECRET_KEY`, `VERIFIER_SECRET_KEY`, `TREASURY_WALLET`, and the program deployed and initialised |
| Paying in local currency, cashing out to a bank | `ONRAMPER_API_KEY`, `ONRAMPER_SIGNING_KEY` |
| Paying in local currency, cashing out to a bank (LocalRamp) | `LOCALRAMP_PUBLIC_KEY`, `LOCALRAMP_SECRET_KEY`; top-ups in money history need `LOCALRAMP_WEBHOOK_TOKEN` |
| Top-ups in money history and their notifications (Onramper) | `ONRAMPER_WEBHOOKS_ENABLED`, `ONRAMPER_WEBHOOK_SECRET` (from Onramper) |
| Browser push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |
| Photo and proof uploads in production | `CLOUDINARY_URL` (Cloudinary free plan); otherwise saved on the server's disk |

## Scripts

| Command | What |
| --- | --- |
| `npm run start:dev` | Watch mode |
| `npm test` | Unit tests (settlement math checked against the program, rep counting, schedule, crypto) |
| `DATABASE_URL=… npm run test:e2e` | API tests against a throwaway database |
| `npm run migration:generate -- src/database/migrations/Name` | Migration from entity changes (then add it to `migrations/index.ts`) |
| `npm run migration:run` / `migration:revert` | Apply or undo migrations by hand |
| `npm run lint` | oxlint (type-aware) |

## How it's organised

Every route is under `/api`. All need a bearer token unless marked public. Admin routes need a
token from `/auth/admin/login`.

| Module | Covers (PRD) |
| --- | --- |
| `auth` | Email/password, Google and GitHub sign-in, rotating refresh sessions with replay detection, wallet sign-in and linking, admin two-factor (§27, §30) |
| `users` | Profiles, privacy, notification preferences, connected accounts (one external account per identity), wallets, downloading your data, closing an account (§24, §11) |
| `challenges` | Creation with approved penalty structures, locked rules documents and hashes, discovery and filters, private and members-only access, invite codes, joining, freezes, progress, leaderboards, lifecycle (§6–8, §12–13, §19–20) |
| `verification` | Adapters, the verification engine, proof uploads and review, provider health and outages (§9, §10, §32) |
| `payments` | Solana client, escrow worker, event indexer, wallet summary, claims, refunds, sponsorships, rent top-ups, Onramper links and webhooks for local currency (§16–18) |
| `disputes` | Opening with evidence and images, the on-chain hold, moderator decisions (§21) |
| `community` | Chat with replies, reactions, mentions, pins and announcements; reports; progress feed; live socket updates on `/live` (§12) |
| `organizations` | Applications and verification, members and roles, invites, dashboard, announcements, CSV export (§14) |
| `reputation` | Commitment score, achievements, people and organization leaderboards (§22–23) |
| `risk` | Sybil and abuse signals, trust levels, risk cases (§11) |
| `notifications` | In-app inbox, email, web push; every event becomes a notification (§25) |
| `admin` | Overview, disputes, proof reviews, risk, reports, users, challenges, orgs, provider health and outages, escrow (read only), audit log, server log, error log, team, settings, four-eyes approvals (§29) |

### Background jobs

| Job | Every | Does |
| --- | --- | --- |
| Lifecycle | 1 min | open → live → settling → ended; settles no-money challenges; drops unsigned joins |
| Verification | 5 min | Checks ended days through the adapters, with retries and outage protection |
| Chain worker | 1–5 min | Creates escrows, writes results with the verifier key, resolves disputes, cancels, settles and finalizes |
| Indexer | 30 s | Reads program events and confirms actions people signed in their own wallets |
| Ranks, reminders | 10 / 30 min | Leaderboard positions and movement, "day closes soon" reminders |
| Onramper | 1 min | Retries webhook events and notifications that failed (only with webhooks on) |

## Guarantees the code keeps

- **Stake-Sync never holds anyone's money or keys.** Every person signs with their own wallet
  (an embedded wallet created at sign-in, or a wallet app they already use). Local currency comes
  in and goes out through licensed on-ramps, straight to and from that wallet.
- **Nobody can move escrowed money.** Not the admin, not the backend. The program only pays out
  under the challenge rules. The admin escrow view is read only.
- **A provider outage never becomes a miss.** Days are retried, then excused. Misses wait 6 hours
  before going on-chain, so an outage declared in time still protects them.
- **No settlement until every day has a final result.** A period nobody checked would otherwise
  count as completed.
- **Stake size never affects rank or reputation.**
- **People never see raw errors.** Every response carries a plain message and a stable `code`;
  details go to the logs with a reference.
- **High-impact admin actions need a second admin:** confirming a failure over $50, restricting
  or suspending an account, changing penalty structures. Every admin action is audited.
