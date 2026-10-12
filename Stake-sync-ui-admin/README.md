# Stake-Sync Admin

Internal admin console for Stake-Sync staff: disputes, proof reviews, risk and Sybil review,
reports, approvals, users, challenges, organizations, verification health, escrow (read-only),
audit log, server log, error log, team roles and platform settings. Built from PRD §11, §21, §29 and §32.

Same stack and design system as the member app: React, Vite, Tailwind v4, GSAP.

```bash
cp .env.example .env
npm install
npm run dev   # http://localhost:5174
```

**Connected to the API** (set `VITE_API_URL`): sign-in, two-step verification (first sign-in walks
an admin through setting up an authenticator app), the **Server log** and the **Error log** use
the real backend. Server and error logs are for Super admins and Risk analysts only, as they
include IP addresses. Other pages still use placeholder data until they're wired up.

Runs on placeholder data until the NestJS admin endpoints exist. The placeholder sign-in accepts a
staff email from `src/data/admin.ts`, any 8+ character password and any 6-digit code.

Principles built into the UI:

- Every action needs a reason and is written to the audit log.
- High-impact actions (restricting or suspending accounts, confirming failures over $50,
  changing penalty structures) need a second admin, never the requester.
- No screen or role can move escrowed funds; settlement runs in the on-chain program.
