-- Expiry is computed once at issue and stored (ADR 0002).
ALTER TABLE cards ADD COLUMN expires_at timestamptz NOT NULL;
