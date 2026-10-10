# 05: Record an Offline Batch atomically

**What to build:** A terminal can upload Redemptions that already happened while Offline. The backend records the whole Offline Batch in Occurred At order, even when it overdraws a Gift Card, and prevents a re-upload from spending the value again.

**Blocked by:** 01: Issue a Gift Card and check its Balance.

**Status:** ready-for-agent

- [ ] Accept the fixture Offline Batch request shape, including its terminal, performing Store, decimal amount strings, Redemption references, and per-Redemption Occurred At values.
- [ ] Parse decimal amounts as strings into integer cents without parseFloat or floating-point money arithmetic. Tests include 8.29 becoming 829, 24.99 becoming 2499, 25.01 becoming 2501, and malformed amounts returning an explicit error.
- [ ] Validate and apply the batch atomically in Occurred At order. Invalid data or an unknown Gift Card leaves no partial value writes.
- [ ] Append negative offline_redeem Ledger Entries for already-authorised Redemptions without refusing them for insufficient Balance or Online Expiry checks. Record enough evidence to identify the cause of an Overdrawn Card.
- [ ] Lock affected Gift Cards in a consistent order, and recompute each Balance cache within the batch transaction. Concurrent batches cannot lose Ledger Entries or corrupt Balances.
- [ ] Apply the global idempotency contract to the batch. Unique redemption_ref protection also prevents a re-upload under a new Idempotency Key from applying any Redemption twice.
- [ ] Real-Postgres HTTP tests apply fixture line 20 in full and verify Gift Card 1005 reaches -1000 cents. Tests cover out-of-order input, transaction rollback, matching retries, and re-upload under a new key.
