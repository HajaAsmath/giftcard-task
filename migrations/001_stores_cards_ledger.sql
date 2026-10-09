CREATE TABLE stores (
  store_id     text PRIMARY KEY,
  name         text NOT NULL,
  legal_entity text NOT NULL,
  currency     text NOT NULL,
  timezone     text NOT NULL
);

CREATE TABLE cards (
  card_id          bigserial PRIMARY KEY,
  card_number      text NOT NULL UNIQUE,   -- digits only, spaces stripped
  pin_hash         text NOT NULL,          -- scrypt$<salt hex>$<hash hex>
  issuing_store_id text NOT NULL REFERENCES stores(store_id),
  balance_minor    bigint NOT NULL DEFAULT 0  -- cache of SUM(ledger_entries.amount_minor)
);

CREATE TABLE ledger_entries (
  entry_id          bigserial PRIMARY KEY,
  card_id           bigint NOT NULL REFERENCES cards(card_id),
  kind              text NOT NULL CHECK (kind IN ('issue', 'reload', 'redeem', 'reverse', 'offline_redeem')),
  amount_minor      bigint NOT NULL,
  occurred_at       timestamptz NOT NULL,
  recorded_at       timestamptz NOT NULL DEFAULT now(),  -- audit only
  store_id          text NOT NULL REFERENCES stores(store_id),
  redemption_ref    text UNIQUE,
  reverses_entry_id bigint REFERENCES ledger_entries(entry_id)
);
CREATE INDEX ledger_entries_card_id ON ledger_entries (card_id);

-- Ledger entries are append-only.
CREATE FUNCTION ledger_entries_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only';
END $$;
CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();
