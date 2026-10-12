# Stake-Sync

Stake USDC on Solana that you'll finish a habit challenge. Progress is verified automatically, misses use strikes, and finishers get their stake back plus rewards.

| Folder | What it is | Stack |
|---|---|---|
| `Stake-sync-ui` | Member app | React, Vite, Tailwind, GSAP |
| `Stake-sync-ui-admin` | Admin console | React, Vite |
| `StakeSync-Backend` | API, verification, settlement | NestJS, TypeORM, Postgres |
| `StakeSync-SmartContract` | Escrow program | Solana Anchor |

Each folder has its own README with setup steps. Copy each `.env.example` to `.env` and fill it in; secrets are never committed.
