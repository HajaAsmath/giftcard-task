# AI build notes

These are the places where the AI got something wrong while building this task and how it is fixed.

1. The AI installed `typescript@latest`, which resolved to 7.x. `ts-jest` only allows TypeScript `>=4.3 <7`. I fixed it by pinning `typescript@5`. I now check peer ranges before installing packages.

2. The AI installed `@testcontainers/postgresql@latest`, which resolved to 12.x. That version pulls in `undici@8`, which requires Node >= 22. The spec pins Node 20, so the suite crashed on load. I fixed it by pinning `@testcontainers/postgresql@11`. I now check `engines` against Node 20 before installing packages.

3. The AI wrote the line-23 expiry test with `2029-10-01T12:59:59.999Z` because it assumed 1 Oct 2029 was in AEDT. Sydney daylight saving time starts on the first Sunday of October, which is 7 Oct in 2029, so 1 Oct is still AEST. I checked the date with `Intl.DateTimeFormat` for Australia/Sydney and changed the expected value to `2029-10-01T13:59:59.999Z`.

4. The AI hashed PINs and fingerprints with `scryptSync`. That blocked the event loop, so concurrent test requests ran one at a time. The concurrency test passed even against a racy check-then-insert mutant. I fixed it by switching to async `scrypt` through the libuv threadpool. The racy mutant now fails the test, and the real claim-first code passes. I now mutation-check concurrency tests that pass on the first run.

5. The AI wrote tests that shared cards and idempotency keys inside one file. For example, the `card_exists` test depended on an earlier test that issued card 1001. The tests passed in declaration order, so the AI reported "27 passing" and closed the ticket without shuffling the run order. `jest --randomize` then failed 4 to 5 tests in 5 of 6 runs. I fixed it so each test issues its own card under its own key through `freshIssue` in `tests/harness.ts`. I verified the fix with 1 default run, 6 shuffled runs where all 27 tests passed, and 3 mutants that still fail when the code is wrong.

6. The bigger failure was that the AI trusted the tests without testing the tests. It ran the suite many times in declaration order and treated "27 passing" as proof. It did not ask whether the suite could pass for the wrong reason. The warning signs were there. Tests reused card 1001 and key `k-c1-iss`, and the first concurrency test passed too easily. I fixed the shared state, shuffled the suite, and used mutants to check that the tests fail when the code is wrong.

7. The AI relied on the two-request fixture race on lines 11 and 12 to prove the row lock. When I removed `FOR UPDATE`, all tests still passed because one request finished before the other request completed its PIN hash. I fixed the coverage by adding a test where 20 tills spend one card at the same time. It fails against the no-lock mutant in 3 of 3 runs. I kept the fixture test because the ticket asks for it.

8. The AI counted the replay ledger entries by hand and used 17 in the double-replay test. The fixture actually produces 19 entries, made up of 8 issues, 7 redeems, 1 reverse, 2 offline entries, and 1 reload. I fixed it by recounting the accepted fixture lines before changing the code, then added the breakdown to the test comment.

9. The AI got the example liability numbers wrong by two decimal places. The fields are named `*_minor`, so the values are cents. The group opening balance should be 14000, not 1400000. The group closing balance should be 16700, not 1670000. The s1 opening balance should be 10000, not 1000000. The September liability examples should be group 16700, s1 10700, s2 2500 with a separate -1000 overdrawn card, and s3 3500. I fixed the examples to use cents consistently.

10. The AI documented `npm run mcp` as the MCP startup command without checking its stdio output. npm prints a two-line banner before the protocol starts, and a strict stdio client will try to parse that banner as JSON. I checked both startup paths by hand and in `tests/mcp-stdio.test.ts`. The README now explains the caveat and uses `npx tsx src/mcp/server.ts` as the clean command.

11. The AI created the read-only role with a hardcoded password and did not call it out. I fixed it by adding a migration comment that says the password is only a local and test default. A real deployment should provision the role and set `MCP_DATABASE_URL`. The README says the same thing.

12. The AI shipped write paths that accepted `occurred_at` values earlier than the card issue time, and reversals earlier than their redemption. A review probe showed the August report marking a card as overdrawn by an online redemption, and the July report carrying a reversal for a card that did not exist yet. No test covered this. I fixed it by adding `cards.issued_at` and 422 refusals on all four paths, as recorded in ADR 0005. I also added tests in `tests/occurred-at.test.ts` and killed five mutants.

13. After the finding-2 mutants, the AI ran `npm run verify` through `grep`, saw 153 failures, and lost the error text again. This repeated the mistake from entry 9. The individual suites passed immediately after. A rerun with output saved to a file passed completely. The likely cause was transient contention on a shared Docker daemon that other containers were also using, but I did not have a saved log to prove it. I fixed the process so verification writes to a file first, for example `npm run verify > log`, and then I grep the file. I should never pipe a verification run straight into a filter.

14. Review fix. The AI's first patch script for `issued_at` asserted on a pattern that did not match the file. It died before writing `ledger.ts`, which left the schema with the new NOT NULL column but no code to set it. Every issue request returned 500. The failing tests caught this within one run. I fixed it by reapplying the change with patterns checked against the file first. I should assert on the real text before replacing it. If a patch applies only halfway, the tests should fail loudly.
