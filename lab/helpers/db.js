// lab/helpers/db.js
//
// pg.Pool factories pointed at the lab DB or template DB.
// Tests connect, do their work, end the pool.

import pg from 'pg';

const HOST = 'localhost';
const PORT = 5433;
const USER = 'lab';
const PASSWORD = 'lab';

export function labPool(database = 'lab') {
  return new pg.Pool({ host: HOST, port: PORT, user: USER, password: PASSWORD, database });
}

export function adminPool() {
  // Connects to `postgres` system DB so we can DROP/CREATE the lab DB.
  return new pg.Pool({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: 'postgres' });
}
