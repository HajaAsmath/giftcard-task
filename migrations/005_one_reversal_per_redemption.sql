-- A redemption can be reversed once. The ledger code checks under a row lock; this index is the backstop.
CREATE UNIQUE INDEX ledger_entries_one_reversal ON ledger_entries (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
