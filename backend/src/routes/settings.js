// Settings routes — HTTP layer for app configuration.
// State + business logic lives in services/configService.js.
import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { getBackupDriverName, setBackupDriverName } from '../services/driverState.js';
import { DELIVERY_STATUS } from '../constants/statuses.js';
import * as orderRepo from '../repos/orderRepo.js';
import {
  getConfig, getAllConfig, updateConfigBulk,
  getDriverOfDay, setDailyDriver, getDailyState,
  driverNames, autoClearIfNewDay,
} from '../services/configService.js';

const router = Router();

// ── GET /api/settings — read all settings + config ──
router.get('/', authorize('orders'), (req, res) => {
  autoClearIfNewDay();
  const backupName = getBackupDriverName();
  const daily = getDailyState();
  const config = getAllConfig();
  const resolvedDrivers = [...new Set([...driverNames, ...config.extraDrivers])]
    .map(name => name === 'Backup' && backupName ? backupName : name);
  res.json({
    driverOfDay:      daily.driverOfDay,
    backupDriverName: backupName,
    drivers:          resolvedDrivers,
    pinDrivers:       driverNames,
    config,
  });
});

// ── PUT /api/settings/driver-of-day ──
// When a driver-of-day is set, auto-assign them to all today's unassigned deliveries.
router.put('/driver-of-day', authorize('admin'), async (req, res, next) => {
  try {
    const { driverName } = req.body;
    setDailyDriver(driverName);

    let assignedCount = 0;
    if (driverName) {
      const today = new Date().toISOString().split('T')[0];
      const allToday = await orderRepo.listDeliveries({ pg: { date: today } });
      const unassigned = allToday.filter(
        d => !d['Assigned Driver'] && d.Status !== DELIVERY_STATUS.DELIVERED
      );
      for (const d of unassigned) {
        await orderRepo.updateDelivery(d.id, { 'Assigned Driver': driverName });
        assignedCount++;
      }
    }

    res.json({ driverOfDay: getDriverOfDay(), assignedCount });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/settings/backup-driver ──
router.put('/backup-driver', authorize('admin'), (req, res) => {
  const { name } = req.body;
  setBackupDriverName(name);
  res.json({ backupDriverName: getBackupDriverName() });
});

// ── PUT /api/settings/config — update + persist ──
router.put('/config', authorize('admin'), async (req, res) => {
  updateConfigBulk(req.body);
  res.json({ config: getAllConfig() });
});

// ── GET /api/settings/lists ──
router.get('/lists', authorize('orders'), (req, res) => {
  res.json({
    suppliers:      getConfig('suppliers'),
    categories:     getConfig('stockCategories'),
    paymentMethods: getConfig('paymentMethods'),
    orderSources:   getConfig('orderSources'),
    floristNames:   getConfig('floristNames'),
    rateTypes:      getConfig('rateTypes'),
    floristRates:   getConfig('floristRates'),
  });
});

export default router;
