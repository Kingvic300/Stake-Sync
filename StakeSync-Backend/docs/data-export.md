# Download my data

`GET /api/me/export` returns everything Stake-Sync keeps about the signed-in person as a JSON
file. They don't need to contact support.

- **Who:** only the signed-in person (bearer token). There's no user id in the request, so
  nobody can ask for someone else's data.
- **How often:** once an hour per person. This is enforced in the database, so it holds across
  every API instance and for simultaneous requests. A second request within the hour gets `429`
  with `code: "export_rate_limited"`, a `Retry-After` header in seconds, and the same number in
  `details.retryAfter`. If building the export fails, the hour is given back.
- **Response:** `200`, `Content-Type: application/json; charset=utf-8`,
  `Content-Disposition: attachment; filename="stakesync-data-YYYY-MM-DD.json"`, `Cache-Control: no-store`.
- **Audit:** each export is recorded in the audit log ("Downloaded their data") with its size and
  how many items each section held. The data itself is never stored.

## What's in it

| Section | Contents |
| --- | --- |
| `profile`, `settings` | Name, handle, email, bio, timezone, interests, score, terms, privacy and notification preferences |
| `connectedAccounts` | Provider and username, plus when connected |
| `wallets` | Address, kind, primary, verified, when linked |
| `challenges` | Each challenge joined: stake, fees, days verified/missed/excused, rank, result, penalty, reward, claimable, transactions |
| `verifications`, `proofs` | Results per day; proof details with a `fileUrl` |
| `disputes` | Reason, status, evidence, timeline, decision |
| `messages`, `feedPosts` | Only what the person wrote |
| `moneyHistory`, `sponsorships` | Ledger entries and sponsorships |
| `organizations`, `achievements` | Memberships with roles; verified achievements |

**Never included:**
- Credentials and sessions: passwords and their hashes, OAuth tokens and provider ids, 2FA
  secrets, sessions.
- Internal signals: IP and device hashes, risk signals and scores, wallet funding sources,
  photo fingerprints and flags.
- Other people: moderator identities and notes, and anyone else's messages, details or ids.
- Storage keys.

Every field is listed explicitly in `DataExportService`, so new database columns don't leak in by accident.

**Private files.** Proof photos and dispute evidence are links to the same signed-in endpoints
the app already uses (`/api/verification/proofs/file/:id`, `/api/disputes/:id/evidence/:n`).
They aren't public storage URLs, and opening one needs the person's sign-in.

## Member app (pending)

> **Pending:** the "Download my data" button in the member app isn't built yet. This backend
> change only provides the endpoint.

Suggested place: Settings → Privacy. The call needs the bearer token, so a plain link won't work. Fetch it and save the result:

```ts
async function downloadMyData(api: string, token: string) {
  const res = await fetch(`${api}/api/me/export`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) {
    const { message } = await res.json(); // "You can download your data once an hour. Try again in N minutes."
    throw new Error(message);
  }
  if (!res.ok) throw new Error('Could not download your data. Please try again.');
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'stakesync-data.json';
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}
```

Show the `message` from a 429 as it is; it's written for people.
