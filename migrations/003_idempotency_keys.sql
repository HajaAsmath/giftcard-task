-- One row per Idempotency Key (global). The response is stored verbatim, refusals included (ADR 0004).
CREATE TABLE idempotency_keys (
  key           text PRIMARY KEY,
  fingerprint   text NOT NULL,   -- sha256 of method, path and canonical body; PIN replaced by a salted hash
  status_code   integer,
  response_body text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
