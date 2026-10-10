# 02: Redeem online without spending the same Balance twice

**What to build:** A caller can redeem a Gift Card at any Store while the guest is present. The backend checks the PIN, Expiry, and available Balance, refuses an invalid Redemption, and prevents concurrent tills from spending the same value twice. Refused Movements remain available for finance reporting.

**Blocked by:** 01: Issue a Gift Card and check its Balance.

**Status:** ready-for-agent

- [ ] An accepted Online Redemption appends a negative Ledger Entry with a unique redemption_ref and the performing Store, while retaining the Gift Card's Issuing Store.
- [ ] Lock the Gift Card row before checking Balance and applying a Redemption. Recompute the Balance cache from the Ledger Entries within the same transaction.
- [ ] Return 400 for malformed requests or missing key or Occurred At, 403 invalid_pin, 404 for an unknown Gift Card, 409 idempotency_conflict, and 422 insufficient_funds or card_expired as applicable. Refusals do not append value movements.
- [ ] Check Expiry against the request's Occurred At and stored Expiry, not the server clock. Fixture line 18 succeeds and line 19 returns card_expired.
- [ ] Persist Refused Movements with the Gift Card, performing Store, attempted amount, code, and business time needed for monthly reporting. Matching retries replay a refusal without creating additional Refused Movements. A conflicting request remains auditable without replacing the original stored response.
- [ ] Reuse the global idempotency contract for successes and refusals. A refused request remains refused when retried after Balance or other Gift Card state changes.
- [ ] Real-Postgres HTTP tests submit fixture lines 11 and 12 concurrently and assert exactly one 201 and one 422, with Balance 1000 cents and no named winner.
- [ ] Tests show line 14 replaying line 13 byte-for-byte, line 15 returning 409 idempotency_conflict, and Gift Card 1004 remaining at 200 cents.
- [ ] Tests cover wrong PIN, unknown Gift Card, Expiry boundaries, and the cross-Store Redemption in fixture line 9 without changing its Issuing Store.
