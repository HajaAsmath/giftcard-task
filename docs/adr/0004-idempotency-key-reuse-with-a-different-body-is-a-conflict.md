# Reusing an Idempotency Key with a different body is a conflict, not a replay

A retry and a genuinely new request can look identical from the ledger's side, because both reuse a key. We fingerprint each write over its method, path and canonical body: the same key with the same fingerprint replays the stored response verbatim, including refusals; the same key with a different fingerprint is refused with `409 idempotency_conflict` and the second request is not applied.

The working note said a repeated key "always returns the stored response", which is wrong in the case that matters — line 15 reuses `k-77` with 1200 after line 13 spent 1800 under it. Replaying the stored response would tell the caller their 1200 went through when nothing happened. The task's own test list separates "a retried request" from "a reused key with a different body", so it expects two distinct behaviours.

**Considered**: replaying on key alone, which is simpler and is what most idempotency middleware does. Rejected because it silently confirms writes that never occurred, which is worse than a 409.

**Consequences**: refusals are stored and replayed too, so a failed redemption cannot be retried into a success after a reload — that is the double-spend this mechanism exists to prevent. One knock-on: a wrong-PIN attempt consumes its key like any other outcome, so a till retrying under the same key gets the same 403 forever; real tills mint a key per attempt.
