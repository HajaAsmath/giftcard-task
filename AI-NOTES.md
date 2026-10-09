# AI Notes

Mistakes the agent made while building this, logged as they happened, with the correction.

| # | Ticket | Mistake | Correction |
|---|---|---|---|
| 1 | 01 | Installed `typescript@latest` (7.x) alongside `ts-jest`, whose peer range is `>=4.3 <7`. | Pinned `typescript@5`. Check peer ranges before installing. |
| 2 | 01 | Installed `@testcontainers/postgresql@latest` (12.x), which pulls in `undici@8` that requires Node >= 22; the spec pins Node 20 and the suite crashed on load. | Pinned `@testcontainers/postgresql@11`. Check `engines` against Node 20 before installing. |
| 3 | 01 | Wrote the line-23 expiry test expecting `2029-10-01T12:59:59.999Z`, assuming 1 Oct 2029 is in AEDT. Sydney DST starts on the first Sunday of October (7 Oct 2029), so that date is still AEST. | Checked with `Intl.DateTimeFormat` for Australia/Sydney before implementing; the expected value is now `2029-10-01T13:59:59.999Z`. |
| 4 | 01 | Hashed PINs and fingerprints with `scryptSync`. It blocked the event loop, so "concurrent" test requests ran one at a time, and the concurrency test passed even against a deliberately racy check-then-insert mutant. | Switched to async `scrypt` (libuv threadpool). The racy mutant now fails the test and the real claim-first code passes. Mutation-check concurrency tests that go green on the first run. |
| 5 | 01 | Wrote tests that shared cards and idempotency keys within a file (for example, the card_exists test relied on an earlier test having issued card 1001). They passed in declaration order, and I reported "27 passing" and closed the ticket without running them shuffled. `jest --randomize` showed 4 to 5 failures in 5 of 6 runs. | Each test now issues its own card under its own key (`freshIssue` in `tests/harness.ts`). Verified with 1 default and 6 shuffled runs (all 27 pass) and 3 mutants that the tests still fail when the code is wrong. |
