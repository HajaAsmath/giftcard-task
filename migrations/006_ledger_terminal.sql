-- Offline entries record which terminal uploaded them, so an overdrawn card can be traced to its source.
ALTER TABLE ledger_entries ADD COLUMN terminal_id text;
