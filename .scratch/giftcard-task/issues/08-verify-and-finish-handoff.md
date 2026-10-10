# 08: Verify the complete workflow and finish the handoff

**What to build:** A reviewer can install, run, replay, test, and inspect the backend using a concise, evidence-backed handoff. The handoff explains the September result, resolves all ten working notes, and states what was not built.

**Blocked by:** 07: Expose the Liability report through read-only MCP.

**Status:** ready-for-agent

- [ ] Run the documented installation, migration, development, replay, test, typecheck, and MCP commands. Record actual commands and outcomes; do not claim skipped or failing checks passed.
- [ ] All eleven specification tests pass against real Postgres. Run the replay command twice and verify the September report remains unchanged. Resolve failures before marking this ticket complete.
- [ ] Provide a concise README with commands actually run, Store and group September opening and closing figures, the 16700-cent group closing Liability, and the finance flags.
- [ ] Include a verdict table for all ten working notes using keep, reject, or rewrite. Explain each decision and cite relevant fixture lines or Store policy evidence; identify where fixtures do not directly establish a security requirement.
- [ ] Provide agent guidance covering the glossary, ADRs, approved stack, required tests, parameterised SQL, integer money, Occurred At, immutable Ledger Entries, and restrictions on PIN storage and fixture edits.
- [ ] Include the skills used and a short AI notes document containing mistakes recorded during implementation and their corrections. Do not invent mistakes or defer earlier tickets' contemporaneous logging until this handoff.
- [ ] Explicitly state that UI, login, intercompany settlement, queues, and deployment were not built. Do not include a send-by time in the README.
- [ ] Do not create an external issue, commit secrets, or push to a remote. Any later commit must follow the project's test-before-commit rule and requires the user's request.
