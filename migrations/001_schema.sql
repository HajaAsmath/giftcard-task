-- The whole schema in one file, in dependency order: stores, cards, the append-only
-- ledger, the idempotency and refusal records, and the read-only role the MCP server
-- connects as. Plain SQL, applied by src/migrate.ts in filename order.

CREATE TABLE stores (
  store_id     text PRIMARY KEY,
  name         text NOT NULL,
  legal_entity text NOT NULL,
  currency     text NOT NULL,
  timezone     text NOT NULL
);

-- expires_at is a fact recorded at issue, like issued_at (ADR 0002); balance_minor is
-- a cache recomputed from the ledger inside the transaction that holds the card lock.
CREATE TABLE cards (
  card_id          bigserial PRIMARY KEY,
  card_number      text NOT NULL UNIQUE,   -- digits only, spaces stripped
  pin_hash         text NOT NULL,          -- scrypt$<salt hex>$<hash hex>
  issuing_store_id text NOT NULL REFERENCES stores(store_id),
  expires_at       timestamptz NOT NULL,
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
  reverses_entry_id bigint REFERENCES ledger_entries(entry_id),
  terminal_id       text  -- offline entries name the terminal that uploaded them
);
CREATE INDEX ledger_entries_card_id ON ledger_entries (card_id);
-- A redemption can be reversed once. The write path checks under a row lock; this index is the backstop.
CREATE UNIQUE INDEX ledger_entries_one_reversal ON ledger_entries (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;

-- Ledger entries are append-only.
CREATE FUNCTION ledger_entries_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only';
END $$;
CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();

-- One row per Idempotency Key (global). The response is stored verbatim, refusals included (ADR 0004).
CREATE TABLE idempotency_keys (
  key           text PRIMARY KEY,
  fingerprint   text NOT NULL,   -- sha256 of method, path and canonical body; PIN replaced by a salted hash
  status_code   integer,
  response_body text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Movements the ledger declined while the guest was present (glossary: Refused Movement).
-- One row per distinct refused request, so a retry never adds a second row.
CREATE TABLE refused_movements (
  refused_id          bigserial PRIMARY KEY,
  card_id             bigint NOT NULL REFERENCES cards(card_id),
  store_id            text NOT NULL REFERENCES stores(store_id),
  amount_minor        bigint NOT NULL,
  code                text NOT NULL,
  occurred_at         timestamptz NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),  -- audit only
  idempotency_key     text NOT NULL,
  request_fingerprint text NOT NULL,
  UNIQUE (idempotency_key, request_fingerprint)
);

-- The MCP server connects as this role, so read-only behaviour is enforced by Postgres,
-- not by tool code. The grants run after every table above exists.
-- The password below is a local and test default so the compose database and the tests work
-- out of the box. A real deployment provisions this role itself and sets MCP_DATABASE_URL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'giftcard_readonly') THEN
    CREATE ROLE giftcard_readonly LOGIN PASSWORD 'readonly';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO giftcard_readonly', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO giftcard_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO giftcard_readonly;
