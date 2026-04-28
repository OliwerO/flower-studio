// Drizzle Kit config — drives `npm run db:generate` (schema diff → SQL migration)
// and `npm run db:studio` (browse the live DB locally).
//
// `db:migrate` does NOT use this file — it imports the schema directly via
// src/db/migrate.js so it can run inside the Railway deploy.

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.js',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
