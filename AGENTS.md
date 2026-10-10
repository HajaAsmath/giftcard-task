# Agent guidance

How to work in this repository. The build loop and its commands live in `.AGENTS.md`; this file is the project
knowledge an agent needs before changing code. `README.md` has the results, `SPEC.md` the contract,
`GLOSSARY.md` the vocabulary, and `docs/adr/` the decisions.

## Read these first

- `GLOSSARY.md` before naming anything. Use Gift Card, Balance, Liability, Issuing Store, Occurred At, Refused
  Movement as the glossary defines them, and avoid the listed alternatives. If a term changes, change the glossary
  in the same commit.
- `docs/adr/0001` to `0004` before changing ledger, expiry, offline or idempotency behaviour. ADRs record decisions
  that contradict the original working notes, and the fixtures win over the notes.
- `SPEC.md` for error codes, the report shape and the success numbers.

## Stack

Node 20, TypeScript, Express, raw `pg`, plain SQL migrations, Jest, `@testcontainers/postgresql`, `@modelcontextprotocol/sdk`.
No ORM, no query builder, no hidden transactions. Ask before adding a dependency. Pin versions that work on Node 20:
`@testcontainers/postgresql@11` (12 needs Node 22) and `typescript@5` (ts-jest peers below 7).

## Rules that are not negotiable

- Money is integer cents in `*_minor` columns. Never `parseFloat` for money; `src/money.ts` parses decimal strings
  by hand because `parseFloat('8.29') * 100` is 828.9999999999999.
- `occurred_at` is the business clock and is required on every write. Never substitute `now()` for it. It drives
  expiry, month buckets and the report. `recorded_at` is audit only.
- No movement is dated before the card was issued, and no reversal before its redemption. Both are refused with 422
  (`occurred_before_issue`, `reversal_before_redemption`), so a bad date cannot rewrite an earlier month's report.
- Ledger entries are append-only. A database trigger refuses UPDATE and DELETE. Correct a mistake with a reverse
  entry, not by editing history.
- Liability belongs to the issuing store (ADR 0001). Overdrawn balances are never netted into liability (ADR 0003).
  Expiry and month boundaries use the performing store's timezone from the `stores` table, never UTC (ADR 0002).
- PINs are stored as salted scrypt hashes and never appear in responses, fingerprints or logs. Use async `scrypt`:
  the synchronous version blocks the event loop, which silently serialises concurrent requests.
- Never edit `fixtures/`. They are the contract. Fixture amounts are cents, except offline batch amounts, which are
  decimal strings.
- Parameterise every SQL value. Keep the SQL visible in the module that uses it.
- Run tests before every commit. Never commit a slice whose tests fail.

## Tests

`npm test` runs Jest against a real Postgres from Testcontainers, one container per file, real migrations. On this
machine Docker runs through Colima, so prefix the command:

```
DOCKER_HOST=unix:///Users/hasmath/.colima/default/docker.sock \
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock npm test
```

Tests go through the HTTP seam. Two exceptions exist and both are deliberate: the report test asserts
`refused_movements` in the database, because no endpoint exposes them before the report, and the MCP tests connect
as the read-only role to prove Postgres refuses its writes.

Each test issues its own card under its own Idempotency Key. Do not let one test depend on another having run:
`jest --randomize` must stay green.

`npm run verify` runs the typecheck, the suite in default order, and the suite three times shuffled. Use it before
committing a slice.

## Before you believe a green test

A passing suite proves nothing on its own. Both of these have already caught real defects here:

1. Run the suite shuffled (`npm test -- --randomize`). Tests that pass only in their written order are testing each
   other, not the code.
2. Break the code on purpose and confirm a test fails. Remove a row lock, ignore a fingerprint, skip a balance
   recompute. If the tests still pass, they are not testing what you think. A small local script makes this quick:
   back up `src/` and `migrations/`, patch one file, run the tests, restore the backup. Restoring with
   `git checkout -- src` instead is a trap: it discards uncommitted work (AI-NOTES entry 6).
3. Prefer a test that creates real contention over one that hopes for it. A two-request race passes even with the
   row lock removed, because one request finishes first. Twenty concurrent requests fail reliably.

## Structure

```
migrations/        numbered plain SQL
src/money.ts       decimal string to cents
src/ledger.ts      issue, redeem, reload, reverse, offline batch, refused movements
src/idempotency.ts fingerprint, store, replay
src/report.ts      the liability report, shared by HTTP and MCP
src/http/          Express routes, validation, error envelope
src/mcp/           tool handler as a plain function, plus the stdio wrapper
src/replay.ts      the replay CLI
tests/             Jest against real Postgres
```

`src/report.ts` serves both `GET /reports/liability` and the MCP tool. Do not add a second calculation for either.
