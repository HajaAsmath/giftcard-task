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
