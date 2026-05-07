// Florist Hours repository — Phase 6 direct Postgres cutover.
import { db } from '../db/index.js';
import { floristHours } from '../db/schema.js';
import { and, isNull, gte, lte, eq, desc } from 'drizzle-orm';

function toWire(row) {
  return {
    id:               row.id,
    Name:             row.name,
    Date:             row.date,
    Hours:            Number(row.hours  || 0),
    'Hourly Rate':    Number(row.hourlyRate || 0),
    'Rate Type':      row.rateType || '',
    Bonus:            Number(row.bonus     || 0),
    Deduction:        Number(row.deduction || 0),
    Notes:            row.notes || '',
    'Delivery Count': row.deliveryCount || 0,
  };
}

export async function list({ month, name } = {}) {
  const conditions = [isNull(floristHours.deletedAt)];
  if (month) {
    const [year, mon] = month.split('-');
    const start = `${year}-${mon}-01`;
    const endDay = new Date(Number(year), Number(mon), 0).getDate();
    const end   = `${year}-${mon}-${String(endDay).padStart(2, '0')}`;
    conditions.push(gte(floristHours.date, start));
    conditions.push(lte(floristHours.date, end));
  }
  if (name) conditions.push(eq(floristHours.name, name));
  const rows = await db.select().from(floristHours).where(and(...conditions)).orderBy(desc(floristHours.date));
  return rows.map(toWire);
}

export async function create(fields) {
  const [row] = await db.insert(floristHours).values({
    name:          String(fields.Name || ''),
    date:          String(fields.Date),
    hours:         String(Number(fields.Hours || 0)),
    hourlyRate:    String(Number(fields['Hourly Rate'] || 0)),
    rateType:      fields['Rate Type'] || null,
    bonus:         String(Number(fields.Bonus || 0)),
    deduction:     String(Number(fields.Deduction || 0)),
    notes:         fields.Notes || '',
    deliveryCount: Number(fields['Delivery Count'] || 0),
  }).returning();
  return toWire(row);
}

export async function update(id, fields) {
  const updates = {};
  if ('Name'           in fields) updates.name          = fields.Name;
  if ('Date'           in fields) updates.date          = fields.Date;
  if ('Hours'          in fields) updates.hours         = String(Number(fields.Hours));
  if ('Hourly Rate'    in fields) updates.hourlyRate    = String(Number(fields['Hourly Rate']));
  if ('Rate Type'      in fields) updates.rateType      = fields['Rate Type'];
  if ('Bonus'          in fields) updates.bonus         = String(Number(fields.Bonus));
  if ('Deduction'      in fields) updates.deduction     = String(Number(fields.Deduction));
  if ('Notes'          in fields) updates.notes         = fields.Notes;
  if ('Delivery Count' in fields) updates.deliveryCount = Number(fields['Delivery Count']);
  const [row] = await db.update(floristHours).set(updates).where(eq(floristHours.id, id)).returning();
  if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
  return toWire(row);
}

export async function remove(id) {
  await db.update(floristHours).set({ deletedAt: new Date() }).where(eq(floristHours.id, id));
}
