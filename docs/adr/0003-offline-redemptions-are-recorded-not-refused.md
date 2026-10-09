# Offline redemptions are recorded even when they exceed the balance

The ledger can refuse a redemption while the guest is present. It cannot refuse one that already happened: an offline batch arrives after the guest has taken the goods. So an offline redemption is applied in full even when it takes the card negative, and the resulting overdrawn card is surfaced to finance as a flag rather than an error. The working note said to reject such redemptions, which would leave the ledger disagreeing with reality and overstate the issuing store's liability.

**Consequences**: card 1005 sits at −1000 cents after line 20; the batch is applied atomically in `occurred_at` order; and overdrawn cards are reported in their own section and never netted against the liability total, because netting is exactly what would hide them.
