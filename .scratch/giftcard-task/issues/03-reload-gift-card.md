# 03: Reload a Gift Card

**What to build:** A caller can add value to an existing Gift Card at a Store and see the updated Balance. Reload does not change the Issuing Store or stored Expiry, and a retry never adds value twice.

**Blocked by:** 01: Issue a Gift Card and check its Balance.

**Status:** ready-for-agent

- [ ] The Reload API accepts the supplied fixture request shape and appends a positive reload Ledger Entry attributed to the performing Store at the supplied Occurred At.
- [ ] Lock the Gift Card and recompute its cached Balance from the Ledger Entries within the write transaction. Existing Ledger Entries remain unchanged.
- [ ] Preserve the Issuing Store and stored Expiry after Reload.
- [ ] Apply the global Idempotency Key contract to Reload successes and refusals. Matching retries return the original response; conflicting reuse returns 409 without adding value.
- [ ] Reject malformed requests, missing Idempotency Key or Occurred At, and unknown Gift Cards with the specified error envelope and status codes.
- [ ] Real-Postgres HTTP tests issue Gift Card 1008 using fixture line 21, apply line 22, and check Balance 2500 cents. Retry and conflict tests prove Reload does not duplicate value and the Balance cache equals the Ledger Entry sum.
