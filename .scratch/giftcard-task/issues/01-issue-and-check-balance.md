# 01: Issue a Gift Card and check its Balance

**What to build:** A runnable backend that issues a Gift Card at a Store and lets a caller check its Balance. Matching retries return the original answer without issuing twice. Use the specification, glossary, fixtures, and existing ADRs as the contract. This first slice includes the runtime, database migrations, and real-Postgres HTTP test setup needed to demonstrate the behaviour.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] Use Node 20, TypeScript, Express, raw pg, plain SQL migrations, Jest, and Testcontainers Postgres. Installation, database startup, migration, development, test, and typecheck commands work as specified. Ask before adding dependencies beyond the approved stack.
- [x] Seed all three Stores, their Legal Entities, currency, and timezone from the supplied Store fixture. Do not modify fixtures.
- [x] Issue creates one Gift Card and one positive Ledger Entry. Card Numbers with or without spaces identify the same Gift Card. Balance check returns the persisted Balance and returns 404 for an unknown Gift Card.
- [x] Store PINs only as salted hashes. Do not retain readable PINs in request fingerprints, persisted responses, or logs.
- [x] Compute and store Expiry at Issue as the end of the issuing Store's local date 36 months after the local sale date. Gift Card 1002 expires at 2026-09-20T13:59:59.999Z.
- [x] Ledger Entries retain Gift Card identity, movement kind, signed integer amount_minor, occurred_at, recorded_at, performing Store, and applicable Redemption and Reversal references. Entries are append-only; Recorded At is audit-only.
- [x] The Balance cache derives from SUM of the Gift Card's Ledger Entries in the same transaction as the write. Existing Gift Card writes lock the Gift Card row with SELECT FOR UPDATE; Issue creation and its Ledger Entry commit together.
- [x] All write routes use a global Idempotency Key and a fingerprint of method, path, and canonical body. Matching retries replay the stored status and response body byte-for-byte, including refusals. Conflicting reuse returns 409 idempotency_conflict without applying the second request. Concurrent matching Issue requests create only one Gift Card and Ledger Entry.
- [x] Malformed writes or missing Idempotency Key or Occurred At return 400 with an explicit error code. Money uses integer cents, SQL values are parameterised, and server time never replaces Occurred At.
- [x] HTTP tests against freshly migrated real Postgres demonstrate Issue, Balance check, validation, concurrent retry safety, and fixture line 4 replaying line 3 byte-for-byte.
- [x] Record agent mistakes in the AI notes as they happen, preserve existing ADR decisions, and update the glossary if terminology changes. These obligations continue in every later ticket.
