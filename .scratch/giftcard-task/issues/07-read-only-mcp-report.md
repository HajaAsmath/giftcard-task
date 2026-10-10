# 07: Expose the Liability report through read-only MCP

**What to build:** An MCP client can request the monthly Liability report, optionally for a known Store, without gaining permission to change Gift Cards or Ledger Entries. The tool is testable directly without an LLM key.

**Blocked by:** 06: Replay the fixtures and produce the monthly Liability report.

**Status:** ready-for-agent

- [ ] Provide a stdio MCP server using the approved SDK and the specified MCP startup command. Expose one tool, liability_report(month, store_id?).
- [ ] The handler calls the shared reporting implementation and returns its report JSON verbatim, without a separate calculation or altered output structure.
- [ ] Validate month against YYYY-MM and a valid calendar month. Validate optional store_id against the Stores table and refuse unknown Stores. Parameterise all SQL values.
- [ ] An omitted Store returns the group report. A known Store returns the corresponding Store-scoped report without returning other Stores' Liability or card-level flags.
- [ ] Connect using a dedicated read-only Postgres role with the read permissions needed for reporting and no write permission on application data. Do not merely enforce read-only behaviour in tool code.
- [ ] Real-Postgres tests call the handler directly without an LLM key, compare its output with the shared report, and cover valid filtering, invalid months, and unknown Stores.
- [ ] A test using the actual MCP role attempts a database write and verifies Postgres refuses it.
