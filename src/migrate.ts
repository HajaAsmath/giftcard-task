import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const STORES_FIXTURE = join(__dirname, '..', 'fixtures', 'stores.json');

/** Applies pending migrations in filename order, then seeds stores from fixtures/stores.json. */
export async function migrate(pool: Pool): Promise<void> {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)');
  const applied = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const name of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(name)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  await seedStores(pool);
}

async function seedStores(pool: Pool): Promise<void> {
  const fixture = JSON.parse(readFileSync(STORES_FIXTURE, 'utf8'));
  for (const s of fixture.stores) {
    await pool.query(
      `INSERT INTO stores (store_id, name, legal_entity, currency, timezone) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (store_id) DO UPDATE
         SET name = EXCLUDED.name, legal_entity = EXCLUDED.legal_entity,
             currency = EXCLUDED.currency, timezone = EXCLUDED.timezone`,
      [s.store_id, s.name, s.legal_entity, fixture.currency, fixture.timezone],
    );
  }
}

if (require.main === module) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://giftcard:giftcard@localhost:5432/giftcard' });
  migrate(pool)
    .then(() => console.log('migrations applied'))
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());
}
