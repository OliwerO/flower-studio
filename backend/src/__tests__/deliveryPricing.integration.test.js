// backend/src/__tests__/deliveryPricing.integration.test.js
import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import deliveryPricingRoutes from '../routes/deliveryPricing.js';
import * as configService from '../services/configService.js';
import * as distanceService from '../services/distanceService.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.role = 'owner'; next(); }); // bypass real PIN auth for this route test
  app.use('/api/delivery-pricing', deliveryPricingRoutes);
  return app;
}

describe('POST /api/delivery-pricing/quote', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns distance, band, and cost for a resolvable address', async () => {
    vi.spyOn(configService, 'getConfig').mockImplementation((key) =>
      key === 'distanceBands' ? [{ id: 1, upToKm: 5, price: 35 }, { id: 2, upToKm: null, price: 80 }] : undefined,
    );
    vi.spyOn(distanceService, 'resolveDistance').mockResolvedValue({
      distanceKm: 3.5, resolvedAddress: 'ul. Kwiatowa 1, Kraków',
    });

    const res = await supertest(buildApp()).post('/api/delivery-pricing/quote')
      .send({ address: 'ul. Kwiatowa 1', deliveryMethod: 'Driver' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      distanceKm: 3.5,
      band: { id: 1, upToKm: 5, price: 35 },
      cost: 35,
      resolvedAddress: 'ul. Kwiatowa 1, Kraków',
    });
  });

  it('returns all-null fields (never an error) for an unresolvable address', async () => {
    vi.spyOn(distanceService, 'resolveDistance').mockResolvedValue(null);

    const res = await supertest(buildApp()).post('/api/delivery-pricing/quote')
      .send({ address: 'not a real place', deliveryMethod: 'Driver' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ distanceKm: null, band: null, cost: null, resolvedAddress: null });
  });

  it('short-circuits to zero cost for Delivery Method = Florist, without calling the distance module', async () => {
    const resolveSpy = vi.spyOn(distanceService, 'resolveDistance');

    const res = await supertest(buildApp()).post('/api/delivery-pricing/quote')
      .send({ address: 'ul. Kwiatowa 1', deliveryMethod: 'Florist' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ distanceKm: null, band: null, cost: 0, resolvedAddress: null });
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});
