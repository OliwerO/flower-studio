// Florist Hours — CRUD for tracking florist work hours + payroll.
import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { pickAllowed } from '../utils/fields.js';
import { getConfig } from '../services/configService.js';
import * as hoursRepo from '../repos/hoursRepo.js';

const router = Router();

const PATCH_ALLOWED = [
  'Name', 'Date', 'Hours', 'Hourly Rate', 'Rate Type', 'Bonus', 'Deduction', 'Notes', 'Delivery Count',
];

// GET /api/florist-hours?month=2026-03&name=Anya
router.get('/', authorize('orders'), async (req, res, next) => {
  try {
    const records = await hoursRepo.list({ month: req.query.month, name: req.query.name });
    res.json(records);
  } catch (err) { next(err); }
});

// GET /api/florist-hours/summary?month=2026-03
// IMPORTANT: this route must be defined BEFORE /:id to avoid Express matching 'summary' as an ID.
router.get('/summary', authorize('orders'), async (req, res, next) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month param required (YYYY-MM)' });
    const records = await hoursRepo.list({ month });
    const configuredRates = getConfig('floristRates') || {};
    const byName = {};
    for (const r of records) {
      const n = r.Name || 'Unknown';
      if (!byName[n]) byName[n] = { name: n, totalHours: 0, totalPay: 0, totalBonus: 0, totalDeduction: 0, deliveries: 0, days: 0, byRateType: {} };
      const hours    = Number(r.Hours || 0);
      const rateType = r['Rate Type'] || '';
      byName[n].totalHours += hours;
      const recordRate   = Number(r['Hourly Rate'] || 0);
      const floristRates = configuredRates[n];
      const fallbackRate = typeof floristRates === 'object' && rateType
        ? (floristRates[rateType] || 0)
        : (typeof floristRates === 'number' ? floristRates : 0);
      const rate = recordRate > 0 ? recordRate : fallbackRate;
      const pay  = (hours * rate) + Number(r.Bonus || 0) - Number(r.Deduction || 0);
      byName[n].totalPay       += pay;
      byName[n].totalBonus     += Number(r.Bonus || 0);
      byName[n].totalDeduction += Number(r.Deduction || 0);
      byName[n].deliveries     += Number(r['Delivery Count'] || 0);
      byName[n].days++;
      if (rateType) {
        if (!byName[n].byRateType[rateType]) byName[n].byRateType[rateType] = { hours: 0, pay: 0 };
        byName[n].byRateType[rateType].hours += hours;
        byName[n].byRateType[rateType].pay   += hours * rate;
      }
    }
    res.json({ month, florists: Object.values(byName), totalRecords: records.length });
  } catch (err) { next(err); }
});

// POST /api/florist-hours
router.post('/', authorize('orders'), async (req, res, next) => {
  try {
    const { name, date, hours, hourlyRate, rateType, bonus, deduction, notes, deliveryCount } = req.body;
    if (!name || !date) return res.status(400).json({ error: 'name and date are required.' });
    const record = await hoursRepo.create({
      Name: name, Date: date, Hours: Number(hours) || 0,
      'Hourly Rate': Number(hourlyRate) || 0,
      'Rate Type': rateType || '',
      Bonus: Number(bonus) || 0, Deduction: Number(deduction) || 0,
      Notes: notes || '', 'Delivery Count': Number(deliveryCount) || 0,
    });
    res.status(201).json(record);
  } catch (err) { next(err); }
});

// PATCH /api/florist-hours/:id
router.patch('/:id', authorize('admin'), async (req, res, next) => {
  try {
    const safeFields = pickAllowed(req.body, PATCH_ALLOWED);
    if (Object.keys(safeFields).length === 0) return res.status(400).json({ error: 'No valid fields to update.' });
    if ('Hours'          in safeFields) safeFields.Hours          = Number(safeFields.Hours) || 0;
    if ('Hourly Rate'    in safeFields) safeFields['Hourly Rate'] = Number(safeFields['Hourly Rate']) || 0;
    if ('Bonus'          in safeFields) safeFields.Bonus          = Number(safeFields.Bonus) || 0;
    if ('Deduction'      in safeFields) safeFields.Deduction      = Number(safeFields.Deduction) || 0;
    if ('Delivery Count' in safeFields) safeFields['Delivery Count'] = Number(safeFields['Delivery Count']) || 0;
    const record = await hoursRepo.update(req.params.id, safeFields);
    res.json(record);
  } catch (err) { next(err); }
});

// DELETE /api/florist-hours/:id
router.delete('/:id', authorize('admin'), async (req, res, next) => {
  try {
    await hoursRepo.remove(req.params.id);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

export default router;
