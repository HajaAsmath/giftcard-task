# Spec: Gift Card Ledger

Vocabulary is in `GLOSSARY.md`. Decisions that contradict the working notes are in `docs/adr/0001`–`0004`.

## Objective

A restaurant group (Harbour Hospitality, three stores, three legal entities, AUD, Australia/Sydney) sells gift cards at one store and lets guests spend them at any store. Build the backend that keeps balances right and tells finance what is still owed to card holders.

Scope: an API for issue, reload, redeem, reverse, offline batch and balance check; a replay command for `fixtures/requests.jsonl`; `GET /reports/liability?month=YYYY-MM`; one read-only MCP tool over that report. Out of scope: UI, login, settlement between stores, queues, deployment.

Assumptions:
1. `fixtures/` and `stores.json` win over the working notes in `task.html`.
2. The API has no authentication, so none is built.
3. All money is integer cents (`*_minor`). Offline batches carry decimal strings, which are parsed as strings.
4. A reversal is always full, and the amount comes from the original redemption.
5. September 2026 is evaluated at `2026-09-30T13:59:59.999Z`, the end of the month in Sydney (UTC+10 on that date).

## Tech Stack

Node 20, TypeScript, Express, raw `pg`, plain SQL migrations, Jest, `@testcontainers/postgresql`, `@modelcontextprotocol/sdk` (stdio). Postgres via Docker. No ORM.

## Commands

```
Install:  npm ci
Migrate:  npm run migrate
Dev:      docker compose up -d db && npm run migrate && npm run dev
Test:     npm test
Replay:   npm run replay -- --base-url http://localhost:3100
MCP:      npm run mcp
Typecheck: npm run typecheck
```

## Project Structure

```
migrations/      → numbered plain SQL files
src/money.ts     → decimal string → cents, no floats
src/clock.ts     → store-local dates, expiry, month bounds
src/ledger.ts    → write path (lock, check, insert, recompute balance)
src/idempotency.ts → fingerprint, store, replay
src/report.ts    → liability report
src/http/        → Express routes and error envelope
src/mcp/         → tool handler (plain function) + stdio wrapper
src/replay.ts    → replay CLI
tests/           → Jest, real Postgres
docs/adr/        → decisions
```

## Behaviour

**Ledger.** One append-only table: `card_id`, `kind` (issue, reload, redeem, reverse, offline_redeem), signed `amount_minor`, `occurred_at` (required), `recorded_at` (audit only), `store_id`, `redemption_ref` (unique), `reverses_entry_id`, `terminal_id` (offline entries only, so an overdrawn card can be traced to its upload). Nothing is updated. `card.balance_minor` is a cache, recomputed from `SUM(amount_minor)` inside the transaction that holds `SELECT … FOR UPDATE` on the card row.

**Online** writes can be refused: 400 malformed or missing `occurred_at` or key; 403 `invalid_pin`; 404 unknown card; 409 `card_exists` (a second Issue of a Card Number already issued, under a new key), `duplicate_redemption_ref` (a redemption_ref already recorded, under a new key), `idempotency_conflict` or `already_reversed`; 422 `insufficient_funds`, `card_expired`, `occurred_before_issue` (a movement dated before the card was issued) or `reversal_before_redemption`. **Offline** batches are applied whole, atomically, in `occurred_at` order, with balances allowed to go negative. Unique `redemption_ref` stops a batch re-uploaded under a new key.

**Time.** No movement is dated before the card was issued, and no reversal before its redemption (ADR 0005). Expiry is the end of the local date 36 months after the local sale date, on the issuing store's clock, stored as `expires_at`. Month buckets use the local calendar of the store that performed the movement. The store timezone is a column seeded from `stores.json`.

**Idempotency.** Global key. Fingerprint = method + path + canonical body. Same key and fingerprint replays the stored response, refusals included. Same key, different fingerprint is a 409 and the second request is not applied. PINs are stored as salted hashes.

**Report.** Per issuing store: opening, movements by kind, closing; group total; flags. Point-in-time by `occurred_at`. Overdrawn balances are never netted into liability.

```
flags: overdrawn_cards      { card_number, store_id, balance_minor, cause }
       expired_with_balance { card_number, store_id, balance_minor, expired_at }
       intercompany         { owes, owed_to, amount_minor }
       refused_movements    { card_number, store_id, amount_minor, code }   // no redemption_ref
```

`refused_movements` leaves out `redemption_ref` so the report is identical whichever of lines 11 and 12 loses the `g1` race.

**MCP.** `liability_report(month, store_id?)` returns the report JSON verbatim. `month` must match `YYYY-MM`; `store_id` is checked against the stores table and an unknown value is refused. It connects as a read-only Postgres role (connection string from `MCP_DATABASE_URL`).

## Code Style

```ts
export function parseAmountToCents(raw: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!m) throw new BadRequest('invalid_amount', `Not a valid amount: ${raw}`);
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}
```

Small pure functions, explicit error codes, SQL kept visible in the module that uses it, no ORM or hidden transactions.

## Testing Strategy

Jest against a fresh Testcontainers Postgres per suite, running real migrations. HTTP tests go through the Express app; the report test runs the same replay code the CLI uses.

1. **Required:** lines 11/12 give exactly one 201 and one 422, balance 1000, with no named winner.
2. **Required:** line 4 replays line 3 byte-for-byte; line 15 is a 409 and card 1004 stays at 200.
3. **Required:** replay, then assert the whole September report JSON.
4. Expiry boundary: line 18 accepted, line 19 refused.
5. Month boundary: line 23 books to October.
6. Offline overdraw: line 20 applied in full, card 1005 at −1000.
7. Cross-store attribution: line 9 is s1's liability; intercompany flag present.
8. Cached balance equals `SUM(ledger)` for every card after replay.
9. Replaying twice gives an identical report.
10. `parseAmountToCents("8.29")` is 829 (`parseFloat` gives 828.9999999999999).
11. MCP handler called directly returns the report; the MCP role is refused a write.

If time runs short, cut 9–11 before 4–8.

## Boundaries

- **Always:** run tests before committing; parameterise every SQL value; keep `occurred_at` as the business clock; update `GLOSSARY.md` when a term changes; log each agent mistake in `AI-NOTES.md` as it happens.
- **Ask first:** adding a dependency beyond the stack above; changing a decision recorded in an ADR; pushing to a remote.
- **Never:** store a PIN readably; use `parseFloat` for money; net an overdraft into liability; substitute `now()` for `occurred_at`; edit `fixtures/`; commit secrets.

## Success Criteria

September 2026 report, in cents:

| Store | Opening | Closing | Notes |
|---|---|---|---|
| s1 | 10000 | 10700 | |
| s2 | 4000 | 2500 | plus 1000 overdrawn, flagged separately |
| s3 | 0 | 3500 | card 1007 (line 23) excluded, it books to October |
| Group | 14000 | **16700** ($167.00) | |

- Flags: overdrawn card 1005 (−1000); expired-with-balance card 1002 (2500, expired `2026-09-20T13:59:59.999Z`); intercompany s1 owes s2 3000, s2 owes s1 6500; refused lines 12 (or 11), 15 and 19.
- All eleven tests pass against real Postgres, and `npm run replay` run twice leaves the report unchanged.
- The README gives the commands run, these numbers, a verdict table for the ten working notes with fixture evidence, and what wasn't built. It does not mention a send-by time.
- Deliverables also include `AGENTS.md`, `AI-NOTES.md` and the skills used.

## Open Questions

1. **Remote:** no git repo exists yet. Where should it live (GitHub or GitLab)? I'll `git init` and commit locally, and won't push until you name a remote.
2. **Dependencies:** the stack above is the full list I intend to install. Say if any should be dropped, for example `@modelcontextprotocol/sdk` if you'd rather hand-roll the stdio protocol.
