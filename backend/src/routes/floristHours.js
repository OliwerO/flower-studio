// Florist Hours — CRUD for tracking florist work hours + payroll.
// Like a timesheet system: clock in hours, add bonuses/deductions, compute pay.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { getConfig } from './settings.js';

const router = Router();
// GET + POST open to both owner and florist (orders resource covers both roles).
// PATCH + DELETE restricted to owner (admin resource) — see per-route guards below.

const PATCH_ALLOWED = [
  'Name', 'Date', 'Hours', 'Hourly Rate', 'Bonus', 'Deduction', 'Notes', 'Delivery Count',
];

function pickAllowed(body, allowedFields) {
  const filtered = {};
  for (const key of allowedFields) {
    if (key in body) filtered[key] = body[key];
  }
  return filtered;
}

// GET /api/florist-hours?month=2026-03&name=Anya
router.get('/', authorize('orders'), async (req, res, next) => {
  try {
    const { month, name } = req.query;
    const filters = [];

    if (month) {
      // month = "2026-03" → filter records where Date starts with that prefix
      const [year, mon] = month.split('-');
      const startDate = `${year}-${mon}-01`;
      const endDay = new Date(Number(year), Number(mon), 0).getDate();
      const endDate = `${year}-${mon}-${String(endDay).padStart(2, '0')}`;
      filters.push(`IS_AFTER({Date}, '${sanitizeFormulaValue(startDate)}')`);
      filters.push(`IS_BEFORE({Date}, '${sanitizeFormulaValue(endDate)}')`);
      // Include the boundary dates
      filters.length = 0;
      filters.push(`NOT(IS_BEFORE({Date}, '${sanitizeFormulaValue(startDate)}'))`);
      filters.push(`NOT(IS_AFTER({Date}, '${sanitizeFormulaValue(endDate)}'))`);
    }
    if (name) {
      filters.push(`{Name} = '${sanitizeFormulaValue(name)}'`);
    }

    const records = await db.list(TABLES.FLORIST_HOURS, {
      filterByFormula: filters.length ? `AND(${filters.join(', ')})` : '',
      sort: [{ field: 'Date', direction: 'desc' }],
    });

    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST /api/florist-hours — log a new entry
router.post('/', authorize('orders'), async (req, res, next) => {
  try {
    const { name, date, hours, hourlyRate, bonus, deduction, notes, deliveryCount } = req.body;

    if (!name || !date) {
      return res.status(400).json({ error: 'name and date are required.' });
    }

    const record = await db.create(TABLES.FLORIST_HOURS, {
      Name:             name,
      Date:             date,
      Hours:            Number(hours) || 0,
      'Hourly Rate':    Number(hourlyRate) || 0,
      Bonus:            Number(bonus) || 0,
      Deduction:        Number(deduction) || 0,
      Notes:            notes || '',
      'Delivery Count': Number(deliveryCount) || 0,
    });

    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/florist-hours/:id — edit an entry (owner only)
router.patch('/:id', authorize('admin'), async (req, res, next) => {
  try {
    const safeFields = pickAllowed(req.body, PATCH_ALLOWED);
    // Convert numeric fields
    if ('Hours' in safeFields) safeFields.Hours = Number(safeFields.Hours) || 0;
    if ('Hourly Rate' in safeFields) safeFields['Hourly Rate'] = Number(safeFields['Hourly Rate']) || 0;
    if ('Bonus' in safeFields) safeFields.Bonus = Number(safeFields.Bonus) || 0;
    if ('Deduction' in safeFields) safeFields.Deduction = Number(safeFields.Deduction) || 0;
    if ('Delivery Count' in safeFields) safeFields['Delivery Count'] = Number(safeFields['Delivery Count']) || 0;

    const record = await db.update(TABLES.FLORIST_HOURS, req.params.id, safeFields);
    res.json(record);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/florist-hours/:id — remove an entry (owner only)
router.delete('/:id', authorize('admin'), async (req, res, next) => {
  try {
    await db.deleteRecord(TABLES.FLORIST_HOURS, req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/florist-hours/summary?month=2026-03
// Payroll summary: per florist totals for the month
router.get('/summary', authorize('orders'), async (req, res, next) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month param required (YYYY-MM)' });

    const [year, mon] = month.split('-');
    const startDate = `${year}-${mon}-01`;
    const endDay = new Date(Number(year), Number(mon), 0).getDate();
    const endDate = `${year}-${mon}-${String(endDay).padStart(2, '0')}`;

    const records = await db.list(TABLES.FLORIST_HOURS, {
      filterByFormula: `AND(NOT(IS_BEFORE({Date}, '${sanitizeFormulaValue(startDate)}')), NOT(IS_AFTER({Date}, '${sanitizeFormulaValue(endDate)}')))`,
      sort: [{ field: 'Date', direction: 'asc' }],
    });

    // Aggregate by name — use configured rate as fallback for records without one
    const configuredRates = getConfig('floristRates') || {};
    const byName = {};
    for (const r of records) {
      const n = r.Name || 'Unknown';
      if (!byName[n]) byName[n] = { name: n, totalHours: 0, totalPay: 0, totalBonus: 0, totalDeduction: 0, deliveries: 0, days: 0 };
      byName[n].totalHours += Number(r.Hours || 0);
      const recordRate = Number(r['Hourly Rate'] || 0);
      const rate = recordRate > 0 ? recordRate : (configuredRates[n] || 0);
      const pay = (Number(r.Hours || 0) * rate) + Number(r.Bonus || 0) - Number(r.Deduction || 0);
      byName[n].totalPay += pay;
      byName[n].totalBonus += Number(r.Bonus || 0);
      byName[n].totalDeduction += Number(r.Deduction || 0);
      byName[n].deliveries += Number(r['Delivery Count'] || 0);
      byName[n].days++;
    }

    res.json({
      month,
      florists: Object.values(byName),
      totalRecords: records.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
