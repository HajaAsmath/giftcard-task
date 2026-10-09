import { Pool } from 'pg';
import { createApp } from './http/app';

const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://giftcard:giftcard@localhost:5432/giftcard' });
const port = Number(process.env.PORT ?? 3000);
createApp(pool).listen(port, () => console.log(`gift card ledger listening on :${port}`));
