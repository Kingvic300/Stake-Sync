# Verification providers

Every integration here can be built and run on a free tier. Paid upgrades only matter at scale.

| Provider | What it proves | Cost to us | How people connect |
| --- | --- | --- | --- |
| **GitHub** | Commits with real changes (5+ lines by default, merges, lockfiles and minified files excluded), pull requests, merged PRs | Free. 5,000 API requests an hour per connected user | OAuth (`/auth/oauth/github/start?mode=connect`) |
| **Solana** | Transactions, interactions with a given program, program deployments from the linked wallet, on devnet or mainnet | Free with public RPC; free tiers from RPC providers (e.g. Helius) for production | Sign a message with the wallet (`/auth/wallet/link`) |
| **LeetCode** | New accepted problems, difficulty floors, "previously unsolved only" | Free, no key. Uses LeetCode's public GraphQL, which is unofficial | Put a one-time code in the profile's "About me" |
| **Codeforces** | New accepted problems, minimum rating | Free official API, about one call every two seconds (queued) | Put a one-time code in first name, last name or organisation |
| **WakaTime** | Minutes of tracked coding per day; hard to fake, pairs well with GitHub | Free plan, which keeps recent history (enough for daily checks) | OAuth (`/auth/oauth/wakatime/start?mode=connect`) |
| **Camera** | Push-ups, sit-ups, squats counted on the phone (MediaPipe), re-counted on the server from the joint-angle trace | Free: runs on the device | Nothing to connect |
| **Health** | Steps or distance from Apple Health / Health Connect | Free: read on the device | Needs the mobile app to read and upload (`POST /verification/health/sync`) |
| **Photo** | Anything without an integration. EXIF date check, duplicate detection across accounts, then human review | Free (storage: local disk or Cloudflare R2's free 10 GB) | Upload in the app |

**Strava has been removed.** You asked to drop tools without a usable free tier. On top of that,
new Strava API apps are limited to one athlete until Strava reviews them, and Strava's newer API
terms restrict showing a person's Strava data to other users, which conflicts with leaderboards.
Fitness is covered by Camera and Health instead, and both apps list Codeforces and WakaTime in its place.

## Connecting LeetCode and Codeforces

Neither has OAuth, so we never need anyone's username in advance. Each person gives theirs once
and proves the account is theirs. Without the proof, someone could claim a top player's account
and win with that player's work.

1. In Settings → Connections, the person types their username, for example `ada_codes`.
2. The backend creates a one-time code like `SS-7K4Q2M`: `POST /me/connections/leetcode/code`
   with `{ "username": "ada_codes" }`. The code is valid for 30 minutes.
3. They paste that code into the "About me" (Summary) section of their LeetCode profile.
4. They tap "I've added the code". The backend reads their public profile and looks for the code:
   `POST /me/connections/leetcode/verify`. If the code is there, the username is saved to their
   account as verified. After that they can delete the code from their profile.

Codeforces is the same with `codeforces` in the path. The code goes in the first name, last name
or organisation (Settings → Social). Joining a challenge that uses either provider is blocked until
it's connected, and each account can be linked to only one Stake-Sync profile.

## How results are decided

- The engine (`VerificationService`) runs every 5 minutes. For each ended day it asks the
  challenge's adapters and records **verified**, **failed** or **excused**. With two providers a
  day needs both.
- If a provider is down, the day becomes **unavailable** and is retried (10 min, 30 min, 1 h, 2 h, 4 h,
  8 h). Still down after 24 hours means **excused**: it can never count against the person.
  Excused days keep being retried, and become verified if the data turns up.
- A miss during a declared or auto-detected provider incident is **excused**.
- A revoked connection is the person's to fix: they're notified at once and the day can be
  disputed, but it isn't excused.
- Misses wait 6 hours before going on-chain, so an outage declared shortly afterwards can still
  protect them.
- The same commit, transaction, program or photo used as proof by two accounts raises a risk
  signal for both.
- **Settlement waits until every participant has a final result for every day.** A day nobody
  checked would otherwise count as completed.

## Adding a provider

1. Write a client in `src/modules/verification/clients/` (plain functions; throw
   `ProviderUnavailable` for outages and `ProviderAuthError` for rejected credentials).
2. Write an adapter in `src/modules/verification/adapters/` implementing `day()` and `count()`
   (and `baseline()` if only new work should count).
3. Add the key to `PROVIDERS` in `challenge.entities.ts` and its label in `common/providers.ts`,
   and register the adapter in `verification.module.ts` and the engine's constructor.
