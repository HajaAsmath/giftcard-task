# AI Notes

Mistakes the agent made while building this, logged as they happened, with the correction.

| # | Ticket | Mistake | Correction |
|---|---|---|---|
| 1 | 01 | Installed `typescript@latest` (7.x) alongside `ts-jest`, whose peer range is `>=4.3 <7`. | Pinned `typescript@5`. Check peer ranges before installing. |
| 2 | 01 | Installed `@testcontainers/postgresql@latest` (12.x), which pulls in `undici@8` that requires Node >= 22; the spec pins Node 20 and the suite crashed on load. | Pinned `@testcontainers/postgresql@11`. Check `engines` against Node 20 before installing. |
