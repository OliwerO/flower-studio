// Environment loaded via --env-file flag in package.json scripts
// (NOT via import 'dotenv/config' — that caused hoisting bugs, see CHANGELOG.md)
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { authenticate } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { validateAirtableSchema } from './services/airtableSchema.js';
import { connectPostgres, disconnectPostgres } from './db/index.js';

import authRoutes          from './routes/auth.js';
import customerRoutes      from './routes/customers.js';
import orderRoutes         from './routes/orders.js';
import stockRoutes         from './routes/stock.js';
import deliveryRoutes      from './routes/deliveries.js';
import dashboardRoutes     from './routes/dashboard.js';
import analyticsRoutes     from './routes/analytics.js';
import stockPurchaseRoutes from './routes/stockPurchases.js';
import webhookRoutes       from './routes/webhook.js';
import eventsRoutes        from './routes/events.js';
import intakeRoutes        from './routes/intake.js';
import settingsRoutes      from './routes/settings.js';
import marketingSpendRoutes from './routes/marketingSpend.js';
import stockLossRoutes     from './routes/stockLoss.js';
import publicRoutes        from './routes/public.js';
import productRoutes       from './routes/products.js';
import stockOrderRoutes    from './routes/stockOrders.js';
import floristHoursRoutes from './routes/floristHours.js';
import premadeBouquetRoutes from './routes/premadeBouquets.js';
import adminRoutes         from './routes/admin.js';

// Validate required env vars on startup — fail early instead of silently breaking at runtime.
// In test-harness mode (TEST_BACKEND=mock-airtable) the AIRTABLE_* keys are
// not actually used, but we still require them to be set to dummy values so
// that any code path that reads them gets a defined string. start-test-backend.js
// fills these with placeholders before importing this file.
const IS_TEST_BACKEND = process.env.TEST_BACKEND === 'mock-airtable';
const REQUIRED_ENV = ['AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID', 'PIN_OWNER', 'PIN_FLORIST'];
const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

// Trust the first proxy hop (Railway's reverse proxy). Without this,
// req.ip resolves to Railway's internal IP for every request, which means
// express-rate-limit keys EVERY caller under the same IP — one brute-force
// would lock out all other users. Setting trust proxy = 1 tells Express to
// honour the X-Forwarded-For header from one upstream hop (Railway), so
// req.ip returns the real client IP. The rate limiter then keys per-client
// as intended, and express-rate-limit stops throwing ValidationError on boot.
app.set('trust proxy', 1);

// Security headers — helmet sets sensible defaults (X-Content-Type-Options,
// X-Frame-Options, etc.). Like adding standard safety labels to every outgoing package.
app.use(helmet());

// CORS — in production, only allow specific frontend origins.
// In dev, allow all origins for convenience.
if (isProduction) {
  const allowedOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  app.use(cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
  }));
} else {
  app.use(cors());
}

// Webhook route needs raw body for HMAC signature verification.
// Must be registered BEFORE the global JSON parser so it can capture raw bytes.
app.use('/api/webhook', express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}), webhookRoutes);

// Parse JSON for all other routes — explicit size limit to prevent oversized payloads.
app.use(express.json({ limit: '1mb' }));

// Public routes — no PIN required
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), testBackend: IS_TEST_BACKEND || false });
});
app.use('/api/auth', authRoutes);
app.use('/api/events', eventsRoutes);   // SSE — no auth needed, lightweight event stream
app.use('/api/public', publicRoutes);   // Storefront data — no auth, consumed by Wix Velo

// Test-only routes (POST /api/test/reset, GET /api/test/state) — mounted
// ONLY when running under TEST_BACKEND=mock-airtable. Both the shim in
// services/airtable.js and db/index.js refuse to boot pglite or the mock
// in NODE_ENV=production, so this conditional is just defence in depth.
if (IS_TEST_BACKEND) {
  const { default: testRoutes } = await import('./routes/test.js');
  app.use('/api/test', testRoutes);
  console.log('[TEST] Mounted /api/test (reset, state, audit, parity).');
}

// All routes below require a valid PIN in the X-Auth-PIN header
app.use(authenticate);

app.use('/api/customers',       customerRoutes);
app.use('/api/orders',          orderRoutes);
app.use('/api/stock',           stockRoutes);
app.use('/api/deliveries',      deliveryRoutes);
app.use('/api/dashboard',       dashboardRoutes);
app.use('/api/analytics',       analyticsRoutes);
app.use('/api/stock-purchases', stockPurchaseRoutes);
app.use('/api/intake',          intakeRoutes);
app.use('/api/settings',        settingsRoutes);
app.use('/api/marketing-spend', marketingSpendRoutes);
app.use('/api/stock-loss',      stockLossRoutes);
app.use('/api/products',        productRoutes);
app.use('/api/stock-orders',    stockOrderRoutes);
app.use('/api/florist-hours',  floristHoursRoutes);
app.use('/api/premade-bouquets', premadeBouquetRoutes);
app.use('/api/admin',           adminRoutes);

// Central error handler — must be last
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

// Verify Airtable field names match what the backend writes — catches
// trailing-space typos and renamed fields at boot instead of runtime.
// See backend/src/services/airtableSchema.js for the rationale.
//
// Skipped in test-harness mode: the validator hits the Airtable Meta API
// with the real PAT, which (a) we don't have in tests and (b) would defeat
// the "no production traffic" guarantee of the harness. The mock has its
// own fixed schema, so the drift this validator catches doesn't apply.
if (!IS_TEST_BACKEND) {
  await validateAirtableSchema();
} else {
  console.log('[SCHEMA CHECK] Skipped — TEST_BACKEND=mock-airtable. Mock fixture is authoritative.');
}

// Postgres — no-op when DATABASE_URL is unset (Phase 1 scaffolding).
// Becomes mandatory once entity cutovers begin in Phase 3.
// In pglite mode this also applies migrations; see db/index.js.
await connectPostgres();

const server = app.listen(PORT, () => {
  console.log(`Flower Studio backend running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown — let in-flight requests finish before exiting.
// Like stopping a production line: finish current pieces, then power down.
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received — closing server gracefully');
  server.close(async () => {
    await disconnectPostgres();
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled promise rejection:', reason);
  server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  server.close(() => process.exit(1));
});
