# Liability belongs to the issuing store, not the redeeming one

A guest can spend a gift card at any of the three stores, so every cross-store redemption raises the question of which legal entity owes the card holder. We book the liability to the store that **sold** the card, and treat the redeeming store's claim as an intercompany receivable — recognised, not settled.

The working note said the opposite ("liability belongs to the store where the card was redeemed"), but `stores.json` sets `liability_owner: "issuing store"`, and the fixture contract says the fixtures win. It also matches how the money actually works: the card holder's contract is with the seller, and each store is a separate company.

**Considered**: attributing liability to the redeeming store, with that store invoicing the issuer at redemption time. Rejected because the liability would then move between legal entities every time a guest ate elsewhere, and the group would still need the issuing store's exposure to reason about expiry and breakage.
