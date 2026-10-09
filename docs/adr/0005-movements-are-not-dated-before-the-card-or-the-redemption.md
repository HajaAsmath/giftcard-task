# Movements are not dated before the card, nor reversals before their redemption

A write arrived with any `occurred_at` the caller chose, including one earlier than the card's issue or, for a
reversal, earlier than the redemption it undoes. Because the report reads past months by `occurred_at`, a bad date
rewrote history: a review probe produced an August report flagging a card overdrawn by an online redemption, and
a July report carrying a reversal of a September redemption.

We now refuse both, with 422 `occurred_before_issue` and 422 `reversal_before_redemption`. The card's issue time
is stored as `cards.issued_at`, written at issue from the same `occurred_at` as the issue entry. It is a fact
recorded at issue, like `expires_at` (ADR 0002), not a cache like `balance_minor`: the append-only ledger trigger
stops the issue entry changing, and nothing updates the column after insert, so it cannot drift.

An offline batch is checked per card and refused whole, so one early item applies nothing. A terminal whose clock
runs behind will therefore produce refusals, which finance sees, rather than a rewritten past.

**Considered**: deriving the issue time from the issue entry in each locked read, with no schema change. Rejected
because a card without an issue entry yields `NULL` and the comparison silently passes; the `NOT NULL` column
removes that edge case. Also considered: accepting out-of-order dates and clamping at report time. Rejected
because the stored data would still be wrong and the ledger would disagree with what the report shows.

**Consequences**: every fixture line is dated after its card's issue, so the September numbers do not move.
Refusals of this class on the redemption route are stored and replayed like any other refusal.
