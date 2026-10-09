-- The MCP server connects as this role, so read-only behaviour is enforced by Postgres, not by tool code.
-- It gets SELECT on the tables that exist now; a future migration adding a table must grant it there too.
-- The password below is a local and test default so the compose database and the tests work out of the box.
-- A real deployment provisions this role itself and sets MCP_DATABASE_URL to the provisioned credential.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'giftcard_readonly') THEN
    CREATE ROLE giftcard_readonly LOGIN PASSWORD 'readonly';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO giftcard_readonly', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO giftcard_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO giftcard_readonly;
