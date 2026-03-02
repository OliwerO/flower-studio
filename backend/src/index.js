import 'dotenv/config';
import express from 'express';
import cors from 'cors';

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

const app = express();

// Middleware
app.use(cors());          // allow all origins in dev — lock down in production
app.use(express.json());  // parse JSON request bodies

// Public routes — no PIN required
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use('/api/auth',    authRoutes);
app.use('/api/webhook', webhookRoutes);

// All routes below require a valid PIN in the X-Auth-PIN header
app.use(authenticate);

app.use('/api/customers',       customerRoutes);
app.use('/api/orders',          orderRoutes);
app.use('/api/stock',           stockRoutes);
app.use('/api/deliveries',      deliveryRoutes);
app.use('/api/dashboard',       dashboardRoutes);
app.use('/api/analytics',       analyticsRoutes);
app.use('/api/stock-purchases', stockPurchaseRoutes);

// Central error handler — must be last
app.use(errorHandler);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Flower Studio backend running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
