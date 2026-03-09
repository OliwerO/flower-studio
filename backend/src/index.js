// Environment loaded via --env-file flag in package.json scripts
// (NOT via import 'dotenv/config' — that caused hoisting bugs, see CHANGELOG.md)
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { authenticate } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';

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

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

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
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use('/api/auth', authRoutes);
app.use('/api/events', eventsRoutes); // SSE — no auth needed, lightweight event stream

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

// Central error handler — must be last
app.use(errorHandler);

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`Flower Studio backend running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown — let in-flight requests finish before exiting.
// Like stopping a production line: finish current pieces, then power down.
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received — closing server gracefully');
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
});
