// backend/src/routes/deliveryPricing.js
import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { getConfig } from '../services/configService.js';
import { resolveDistance } from '../services/distanceService.js';
import { bandForDistanceKm, computeDeliveryCost, toBandSnapshot } from '../services/deliveryPricingService.js';
import { DELIVERY_METHOD } from '../constants/statuses.js';

const router = Router();
router.use(authorize('deliveries'));

// POST /api/delivery-pricing/quote — stateless: never touches the deliveries
// table. The wizard/detail panels call this on address change, then persist
// whatever it returns (or an Owner override) at order-create / PATCH time.
router.post('/quote', async (req, res, next) => {
  try {
    const { address, deliveryMethod } = req.body;

    if (deliveryMethod === DELIVERY_METHOD.FLORIST) {
      return res.json({ distanceKm: null, band: null, cost: 0, resolvedAddress: null });
    }

    const distance = await resolveDistance(address);
    if (!distance) {
      return res.json({ distanceKm: null, band: null, cost: null, resolvedAddress: null });
    }

    const bands = getConfig('distanceBands') || [];
    const band = bandForDistanceKm(distance.distanceKm, bands);
    const cost = computeDeliveryCost(distance.distanceKm, bands);

    res.json({
      distanceKm: distance.distanceKm,
      band: toBandSnapshot(band),
      cost,
      resolvedAddress: distance.resolvedAddress,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
