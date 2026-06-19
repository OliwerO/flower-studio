// SAFE — read-only. Count rows with NULL Variety attrs (#292 backfill scope).
import { db } from '../src/db/index.js';
import { sql } from 'drizzle-orm';

const r = await db.execute(sql`
  SELECT
    COUNT(*) FILTER (WHERE type_name IS NULL)                                 AS null_type,
    COUNT(*) FILTER (WHERE type_name IS NULL AND current_quantity <> 0)       AS null_nonzero,
    COUNT(*) FILTER (WHERE type_name IS NULL AND current_quantity < 0)        AS null_negative,
    COUNT(*) FILTER (WHERE type_name IS NULL AND active = true)               AS null_active,
    COUNT(*) AS total
  FROM stock WHERE deleted_at IS NULL
`);
console.log(r.rows[0]);
process.exit(0);
