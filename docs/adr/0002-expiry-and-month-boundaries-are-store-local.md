# Expiry and month boundaries are read on the store's local clock

Expiry is "end of the expiry date, store local time" (`stores.json`), and monthly reporting is bucketed by the same clock. We rejected the working note's "check expiry and month end in UTC". Sydney runs UTC+10/+11, so a UTC rule would accept a redemption the till had already refused and would file a 00:30 Sydney sale under the previous month.

Two fixture lines exist only to catch this: line 18 is accepted and line 19 refused, fifty minutes apart on the same card, either side of `2026-09-20T13:59:59.999Z`; and line 23 books to October, not September.

**Consequences**: the store's timezone lives in the database rather than in code; `expires_at` is computed at issue and stored, so a later policy change cannot silently rewrite the expiry of cards already sold; and `occurred_at` is required on every write, so no server clock can stand in for a caller's business time.
