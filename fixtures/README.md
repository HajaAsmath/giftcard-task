# Fixtures

- `stores.json`: stores, legal entities, gift card policy.
- `requests.jsonl`: everything the terminals and the web shop sent, in send order. Replay it against your API. Lines that share a `concurrent_group` were sent at the same moment.

Amounts ending `_minor` are integer cents. Times are UTC ISO 8601.
