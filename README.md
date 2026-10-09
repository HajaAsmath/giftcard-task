# Gift card ledger

Backend for a restaurant group that sells gift cards at one store and honours them at all three. It issues,
reloads, redeems, reverses and records offline batches, and reports the liability each issuing store still owes
card holders. TypeScript, Express, Postgres, no ORM.

## Commands run

Recorded from the run that produced the numbers below. Docker on this machine runs through Colima, so the test
command needs the two environment variables; the dev server used port 3100 because 3000 was already taken.

| Command | Outcome |
|---|---|
| `npm ci` | exit 0 |
| `docker compose up -d db` | Postgres 16 up, `pg_isready` before migrating |
| `npm run migrate` | `migrations applied`. Run twice, same result: migrations and the store seed are idempotent |
| `npm run dev` | `gift card ledger listening on :3100` |
| `npm run replay -- --base-url http://localhost:3100` | 23 lines sent in file order; statuses below. Run twice, report byte-identical |
| `npm test` | 169 passed, 169 total, against real Postgres. Also run 3 times with `--randomize`, all green |
| `npm run typecheck` | clean |
| `npm run mcp` | answered `initialize`, `tools/list` and `tools/call` over stdio. See the caveat below |

Replay statuses, line by line: lines 1 to 11 `201`; line 12 `422 insufficient_funds` (the loser of the concurrent
pair, either order is fine); lines 13, 14 `201`; line 15 `409 idempotency_conflict`; lines 16 to 18 `201`;
line 19 `422 card_expired`; lines 20 to 23 `201`.

The MCP server is read-only by database role, and `tests/mcp-stdio.test.ts` drives it over the real protocol.
Two caveats. `npm run mcp` makes npm print its two-line banner to stdout before the protocol starts; the server
itself is clean, so a strict client should run `npx tsx src/mcp/server.ts` instead. And the read-only role's
password in migration 007 is a local and test default, to be replaced by provisioning in a real deployment.

## September 2026

Liability in cents, at `2026-09-30T13:59:59.999Z`, the end of the month on the Sydney clock.

| Issuing store | Opening | Closing | Movement | Excluded (overdrawn) |
|---|---|---|---|---|
| s1 CBD | 10000 | 10700 | issues 8000, redeems -11300, reverses 4000 | 0 |
| s2 Bondi | 4000 | 2500 | issues 4000, redeems -1500, offline -5000 | 1000 |
| s3 Parramatta | 0 | 3500 | issues 4000, reloads 1500, redeems -2000 | 0 |
| Group | 14000 | **16700** | | 1000 |

Card 1007 (line 23) is not in this table: it was sold at 00:30 Sydney time on 1 October, so it books to October,
where s3 opens at 3500 and closes at 6000.

What finance should look at, from the same report:

- Overdrawn: card 1005 at -1000, excluded from the totals above and flagged with its cause, the offline redemption
  `rd-5-2` from terminal `t-s1-03` at s1.
- Expired with a balance: card 1002, s2, 2500, expired `2026-09-20T13:59:59.999Z`. Still liability, still flagged.
- Intercompany: s1 owes s2 3000, s2 owes s1 6500. Recognised, never settled.
- Refused movements: card 1003 2000 `insufficient_funds`, card 1004 1200 `idempotency_conflict`,
  card 1002 500 `card_expired`. No `redemption_ref`, so the report is the same whichever of lines 11 and 12 wins.

## The ten working notes

| # | Working note | Verdict | Why, and the evidence |
|---|---|---|---|
| 1 | Keep a balance column: read it, check it, update it | rewrite | Keep the column, never trust it. Every write recomputes it from `SUM(ledger_entries)` inside the transaction holding the card row lock, and a test asserts the cache equals the sum for every card after replay. A stored figure read as truth drifts. |
| 2 | A repeated Idempotency-Key always returns the stored response | rewrite | Replay only when the fingerprint matches. Line 15 reuses `k-77` with 1200 after line 13 spent 1800 under it; replaying would confirm a write that never happened. ADR 0004. |
| 3 | Reject offline redemptions that exceed the balance | reject | The guest already has the goods. Line 20 takes card 1005 to -1000 and the overdrawn card is flagged. ADR 0003. |
| 4 | Cards expire 12 months after sale | reject | `stores.json` sets `expiry_months_from_sale: 36`. Card 1002, sold 2023-09-20, expires `2026-09-20T13:59:59.999Z`; lines 18 and 19 straddle it. |
| 5 | Check expiry and month end in UTC | reject | Sydney is UTC+10/+11. Line 18 is accepted at 13:30Z and line 19 refused at 14:20Z on 20 September; line 23 books to October. ADR 0002. |
| 6 | Liability belongs to the store where the card was redeemed | reject | `stores.json` sets `liability_owner: "issuing store"`. Line 9 spends 3000 of s1-issued card 1001 at s2: s1's liability falls, and s1 owes s2 3000. ADR 0001. |
| 7 | Offline amounts: `parseFloat(amount) * 100` | reject | `parseFloat('8.29') * 100` is 828.9999999999999. Line 20 carries 24.99 and 25.01, and test 10 pins 8.29 to 829. |
| 8 | Store the PIN so support can read it out | reject | The glossary defines the PIN as a secret known only to the card holder. PINs are stored as salted scrypt hashes, are not in fingerprints or responses, and a test asserts a response never contains the PIN. |
| 9 | Net overdrawn cards against the liability total | reject | Netting is what hides them. ADR 0003. Netted, the group closing would read 15700 instead of 16700, with card 1005 invisible. |
| 10 | Let the MCP tool take `store_id` from the agent | rewrite | Take the parameter, never trust it. It is checked against the stores table, an unknown store is refused, SQL values are parameterised, and a scoped report omits other stores' liability and all card-level flags. |

Two of these, notes 8 and 10, are not established by any fixture line. No line asserts PIN readability or restricts
what a caller may ask for. The requirements come from the glossary and the spec, and note 10 is limited by the
spec's assumption that the API has no authentication, so the tool validates its input rather than authorising it.

## The eleven specification tests

All eleven pass against real Postgres. Each is named here so a reviewer can run it alone.

| # | Test | Where |
|---|---|---|
| 1 | One 201 and one 422 from lines 11 and 12, balance 1000, no named winner | `tests/redeem.test.ts` |
| 2 | Line 4 replays line 3; line 15 is a 409 and card 1004 stays at 200 | `tests/issue-idempotency.test.ts`, `tests/redeem.test.ts` |
| 3 | The whole September report JSON after replay | `tests/report.test.ts` |
| 4 | Line 18 accepted, line 19 refused | `tests/redeem.test.ts` |
| 5 | Line 23 books to October | `tests/report.test.ts` |
| 6 | Line 20 applied in full, card 1005 at -1000 | `tests/offline-batch.test.ts` |
| 7 | Line 9 is s1's liability, intercompany flag present | `tests/report.test.ts` |
| 8 | Cached balance equals `SUM(ledger_entries)` for every card | `tests/report.test.ts` |
| 9 | Replaying twice gives an identical report | `tests/report-replay.test.ts` |
| 10 | `parseAmountToCents("8.29")` is 829 | `tests/money.test.ts` |
| 11 | The MCP handler returns the report; the MCP role cannot write | `tests/mcp.test.ts`, `tests/mcp-stdio.test.ts` |

## Not built

UI, login and any authentication, settlement between stores (intercompany is recognised only), queues, and
deployment. The API has no auth by design, per the spec's assumption 2.

## Skills used

`tdd` and `incremental-implementation` drove the loop: a failing test, the smallest implementation, then a commit.
`codebase-design` shaped the seams (`ledger.ts`, `report.ts`, `mcp/tool.ts` as plain functions behind thin
interfaces). `to-tickets` produced the ticket set in `.scratch/giftcard-task/issues/`. `unslop` was used to rewrite
one skill instruction. `AI-NOTES.md` records the mistakes made along the way.
