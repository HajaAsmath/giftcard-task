# Gift Card Ledger

Tracks prepaid gift card value across the stores of one restaurant group, and reports what the group still owes card holders.

## Language

**Store**:
A physical restaurant location where gift cards are sold and spent.
_Avoid_: Branch, outlet, site, location

**Legal Entity**:
The company that owns a Store. Every Store is its own Legal Entity, so value moving between Stores moves between companies.
_Avoid_: Company, business unit

**Gift Card**:
A prepaid balance sold at a Store and spendable at any Store in the group.
_Avoid_: Voucher, card, account

**Card Number**:
The printed identifier of a Gift Card. Written with spaces; the same card arrives with and without them.
_Avoid_: PAN, card id

**PIN**:
A four-digit secret that authorises spending a Gift Card. Known only to the card holder.
_Avoid_: Password, code

**Issue**:
The sale that creates a Gift Card and its opening balance.
_Avoid_: Activation, purchase, sale

**Reload**:
Adding value to an existing Gift Card.
_Avoid_: Top-up, recharge, load

**Redemption**:
Spending part of a Gift Card's balance at a Store, confirmed against the ledger while the guest is present.
_Avoid_: Purchase, spend, usage

**Reversal**:
Undoing a Redemption in full, returning the whole amount to the card.
_Avoid_: Refund, void, cancellation

**Offline Batch**:
A set of Redemptions a terminal authorised while disconnected from the ledger, uploaded together later. The guest already has the goods when the batch arrives.
_Avoid_: Sync, upload, deferred redemption

**Ledger Entry**:
One recorded movement of value on a Gift Card.
_Avoid_: Transaction, record, event

**Balance**:
The value still available on a Gift Card, derived from its Ledger Entries. Any stored figure is a cache of that derivation, never the source of truth.
_Avoid_: Amount, remaining value

**Liability**:
What a Store owes the holders of the Gift Cards it issued. Owned by the issuing Store, never the redeeming one.
_Avoid_: Debt, exposure, outstanding

**Issuing Store**:
The Store that sold a Gift Card. Owns its Liability and anchors its Expiry.
_Avoid_: Home store, origin store

**Intercompany Receivable**:
What a redeeming Store is owed by the issuing Store for value spent away from home. Recognised, not settled.
_Avoid_: Transfer, settlement, rebate

**Expiry**:
The moment a Gift Card stops being spendable: the end of the expiry date, read on the issuing Store's local clock, 36 months after the sale.
_Avoid_: Expiration date, death date

**Store-local time**:
The clock of the Store a movement belongs to. Expiry and month boundaries are read on it, not on UTC.
_Avoid_: Local time, business time

**Overdrawn Card**:
A Gift Card whose Balance has gone negative, because an Offline Batch spent more than the card held.
_Avoid_: Negative balance, deficit, breach

**Online**:
A Redemption the ledger can still refuse, because the guest is present.
_Avoid_: Connected, live, synchronous

**Offline**:
A Redemption the ledger can no longer refuse, because the terminal already authorised it. Recorded as it happened.
_Avoid_: Disconnected, batch, asynchronous

**Idempotency Key**:
A caller-supplied token naming one intended write, so a retry is recognised as the same write rather than a second one.
_Avoid_: Request id, dedupe key, correlation id

**Idempotency Conflict**:
A second request reusing an Idempotency Key with a different request. Refused; the original stands.
_Avoid_: Duplicate, key reuse error

**Occurred At**:
When a movement happened in the world, as reported by the caller. Drives Expiry and the monthly report.
_Avoid_: Timestamp, event time, created at

**Recorded At**:
When the ledger first heard about a movement. Audit only; never drives Expiry or the monthly report.
_Avoid_: Received at, created at, ingested at

**Refused Movement**:
A movement the ledger declined because the guest was present and the card could not pay, or because its Idempotency Key was reused for a different request (the spec lists fixture line 15 as refused). Recorded so finance can see what the tills attempted.
_Avoid_: Failed transaction, error, rejection
