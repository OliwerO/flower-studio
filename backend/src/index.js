// Environment loaded via --env-file flag in package.json scripts
// (NOT via import 'dotenv/config' — that caused hoisting bugs, see CHANGELOG.md)
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { authenticate } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
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
import productImagesRouter from './routes/productImages.js';
import orderImagesRouter from './routes/orderImages.js';
import stockOrderRoutes    from './routes/stockOrders.js';
import floristHoursRoutes from './routes/floristHours.js';
import premadeBouquetRoutes from './routes/premadeBouquets.js';
import adminRoutes         from './routes/admin.js';
import feedbackRoutes      from './routes/feedback.js';
import { startFeedbackBot } from './services/feedbackTelegramBot.js';
import { startDriverBot } from './services/driverBot.js';

// Validate required env vars on startup — fail early instead of silently breaking at runtime.
const REQUIRED_ENV = ['DATABASE_URL', 'PIN_OWNER', 'PIN_FLORIST'];
const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// Test-harness gate. The harness boots with `DATABASE_URL=pglite:memory`,
// which is also the in-process pglite sentinel in db/index.js. Any boot
// with a real `postgresql://` DSN is production / dev-prod. Test routes
// (POST /api/test/reset, GET /api/test/state, etc.) only mount under the
// pglite gate. Pre-PR-2b this was keyed on TEST_BACKEND=mock-airtable;
// now the airtable mock is gone and the only test-mode signal we need
// is "are we running on pglite?".
const IS_HARNESS = process.env.DATABASE_URL === 'pglite:memory';

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
  res.json({ status: 'ok', timestamp: new Date().toISOString(), harness: IS_HARNESS });
});
app.use('/api/auth', authRoutes);
app.use('/api/events', eventsRoutes);   // SSE — no auth needed, lightweight event stream
app.use('/api/public', publicRoutes);   // Storefront data — no auth, consumed by Wix Velo

// Test-only routes (POST /api/test/reset, GET /api/test/state) — mounted
// ONLY under the pglite harness. db/index.js refuses to boot pglite in
// NODE_ENV=production, so this conditional is defence in depth.
if (IS_HARNESS) {
  const { default: testRoutes } = await import('./routes/test.js');
  app.use('/api/test', testRoutes);
  console.log('[TEST] Mounted /api/test (reset, state, audit, parity).');
}

// All routes below require a valid PIN in the X-Auth-PIN header
app.use(authenticate);

app.use('/api/customers',       customerRoutes);
app.use('/api/orders',          orderImagesRouter);
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
app.use('/api/products',        productImagesRouter);
app.use('/api/products',        productRoutes);
app.use('/api/stock-orders',    stockOrderRoutes);
app.use('/api/florist-hours',  floristHoursRoutes);
app.use('/api/premade-bouquets', premadeBouquetRoutes);
app.use('/api/admin',           adminRoutes);
app.use('/api/feedback',        feedbackRoutes);

// Central error handler — must be last
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

// Postgres connect — applies pending migrations on boot in pglite mode;
// real-PG mode runs the dir-based migration runner via db/migrate.js.
await connectPostgres();

startFeedbackBot();
startDriverBot();

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
