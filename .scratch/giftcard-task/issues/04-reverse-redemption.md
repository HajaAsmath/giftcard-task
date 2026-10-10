# 04: Reverse a Redemption in full

**What to build:** A caller can undo a Redemption by its reference and recover its entire original amount. A repeated request returns the original answer, while a second intended Reversal of the same Redemption is refused.

**Blocked by:** 02: Redeem online without spending the same Balance twice.

**Status:** ready-for-agent

- [ ] Resolve the original Redemption from redemption_ref and derive the full Reversal amount from that Ledger Entry, rather than from a caller-supplied amount.
- [ ] Append one positive reverse Ledger Entry linked through reverses_entry_id, with the required Occurred At and Store attribution derived from the original Redemption. Do not update or delete the original entry.
- [ ] Lock the Gift Card and make the Reversal, single-Reversal protection, Balance recomputation, and idempotency outcome atomic.
- [ ] A matching retry replays the original status and response body. A second Reversal under a new key returns 409 already_reversed and restores no further value. Conflicting key reuse follows the global contract.
- [ ] Invalid requests and unknown Redemption references return explicit errors without changing any Balance.
- [ ] Real-Postgres HTTP tests apply fixture lines 16 and 17 and verify Gift Card 1006 returns to 6000 cents. Tests cover matching retries, a second Reversal under a new key, and concurrent Reversals without restoring value twice.
