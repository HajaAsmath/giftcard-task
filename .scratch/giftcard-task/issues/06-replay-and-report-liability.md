# 06: Replay the fixtures and produce the monthly Liability report

**What to build:** A developer can replay the supplied terminal and web requests, and finance can retrieve a point-in-time monthly Liability report with balances and exceptions by Issuing Store. The report remains identical after a second replay and regardless of which concurrent Redemption wins.

**Blocked by:** 03: Reload a Gift Card; 04: Reverse a Redemption in full; 05: Record an Offline Batch atomically.

**Status:** ready-for-agent

- [ ] The replay command accepts the specified base URL option and sends the supplied requests in send order. Requests sharing a concurrent_group run in parallel, and the group completes before subsequent requests run. Expected refusals do not stop replay.
- [ ] Expose GET /reports/liability?month=YYYY-MM with a validated month and a shared report function suitable for the later MCP handler.
- [ ] Return opening Liability, movements by kind, closing Liability, group totals, and flags per Issuing Store. Compute historical balances from Ledger Entries using Occurred At, not current Balance caches or Recorded At.
- [ ] Use the performing Store's local calendar for movement month boundaries and the stored issuing-Store Expiry for Expiry flags. Evaluate September 2026 at 2026-09-30T13:59:59.999Z. Fixture line 23 belongs to October, not September.
- [ ] Attribute Liability to the Issuing Store. Exclude Overdrawn Card balances from Liability totals rather than netting them against positive balances. Expired balances remain visible in Liability and receive their own flag.
- [ ] Opening and closing Liability in cents are s1 10000 and 10700, s2 4000 and 2500, s3 0 and 3500, and group 14000 and 16700.
- [ ] overdrawn_cards contains Gift Card 1005, its Issuing Store, Balance -1000, and cause. expired_with_balance contains Gift Card 1002, Issuing Store s2, Balance 2500, and expired_at 2026-09-20T13:59:59.999Z.
- [ ] intercompany recognises that s1 owes s2 3000 cents and s2 owes s1 6500 cents. Cross-Store Redemption reduces the issuer's Liability and recognises an Intercompany Receivable without implementing settlement.
- [ ] refused_movements includes the losing request from fixture lines 11/12, line 15, and line 19, with card_number, store_id, amount_minor, and code. Omit redemption_ref so the report does not depend on the race winner. Retries do not duplicate these flags.
- [ ] A real-Postgres test uses the same replay implementation as the CLI and asserts the complete September report JSON, not only totals. Tests verify month boundaries, cross-Store attribution, and cached Balance equalling SUM of Ledger Entries for every Gift Card.
- [ ] Replaying the full fixture twice produces identical reports without extra value movements or duplicated refusal flags.
