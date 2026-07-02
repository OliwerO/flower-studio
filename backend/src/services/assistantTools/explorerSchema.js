// backend/src/services/assistantTools/explorerSchema.js
//
// Projects the `query_records` allow-list (SCHEMA in dataQueryPack.js) into a
// UI-safe descriptor for the Explorer front-end (ADR-0010). The descriptor is
// plain, serializable data — it never leaks a Drizzle column object, so the
// Explorer UI can render entity/field pickers and drill buttons without ever
// touching the DB layer directly. One allow-list, two front-ends.

import { getTableColumns, getTableName } from 'drizzle-orm';
import { SCHEMA } from './dataQueryPack.js';

// Reverse-map a Drizzle column reference back to the JS property name that a
// plain `db.select().from(table)` returns it under. query_records' non-
// aggregate path emits rows keyed by these jsKeys (camelCase), which diverge
// from the model-facing field names for renamed columns (e.g. `price` →
// `priceOverride`). The Explorer grid needs this key to read cell values.
// Cached per table so getTableColumns only runs once per entity.
const _keyMapCache = new Map();
function runtimeKeyFor(table, col) {
  let map = _keyMapCache.get(table);
  if (!map) {
    map = new Map();
    for (const [jsKey, column] of Object.entries(getTableColumns(table))) {
      map.set(column, jsKey);
    }
    _keyMapCache.set(table, map);
  }
  return map.get(col);
}

// Reverse-map a Drizzle column reference to the MODEL-facing field name it is
// allow-listed under in an entity's `fields`. Used to translate a join's
// foreignCol into the filter field name the query_records engine expects.
function modelFieldFor(entityDef, col) {
  if (!entityDef) return null;
  for (const [name, def] of Object.entries(entityDef.fields)) {
    if (def.col === col) return name;
  }
  return null;
}

// Russian labels for each allow-listed entity.
const ENTITY_LABELS = {
  orders:             'Заказы',
  customers:          'Клиенты',
  order_lines:        'Позиции заказа',
  stock:              'Склад (цветы)',
  purchases:          'Закупки',
  writeoffs:          'Списания',
  deliveries:         'Доставки',
  marketing:          'Маркетинг',
  key_people:         'Близкие клиента',
  stock_orders:       'Заказы поставщику',
  stock_order_lines:  'Позиции заказа поставщику',
  florist_hours:      'Часы флористов',
};

// English labels — the descriptor ships BOTH so the Explorer grid follows the
// dashboard language toggle (the whole app is bilingual RU/EN).
const ENTITY_LABELS_EN = {
  orders:             'Orders',
  customers:          'Customers',
  order_lines:        'Order lines',
  stock:              'Stock (flowers)',
  purchases:          'Purchases',
  writeoffs:          'Write-offs',
  deliveries:         'Deliveries',
  marketing:          'Marketing',
  key_people:         'Key people',
  stock_orders:       'Purchase orders',
  stock_order_lines:  'PO lines',
  florist_hours:      'Florist hours',
};

// Russian labels for individual fields, keyed by field name (model-facing name
// used in SCHEMA, not the DB column name). Shared across entities — a field
// named `status` means the same thing everywhere it appears. Fields not
// listed here fall back to the raw field name.
const FIELD_LABELS = {
  id:                  'ID',
  orderDate:           'Дата заказа',
  requiredBy:          'Нужно к',
  status:              'Статус',
  deliveryType:        'Тип доставки',
  source:              'Источник',
  paymentStatus:       'Статус оплаты',
  paymentMethod:       'Способ оплаты',
  price:               'Цена',
  customerId:          'ID клиента',
  name:                'Имя',
  phone:               'Телефон',
  segment:             'Сегмент',
  orderId:             'ID заказа',
  stockItemId:         'ID товара на складе',
  quantity:            'Количество',
  sellPrice:           'Цена продажи',
  flowerName:          'Название цветка',
  colour:              'Цвет',
  type:                'Тип',
  purchaseDate:        'Дата закупки',
  supplier:            'Поставщик',
  stockId:             'ID товара на складе',
  stockAirtableId:     'Airtable ID товара',
  quantityPurchased:   'Куплено (шт.)',
  pricePerUnit:        'Цена за единицу',
  notes:               'Заметки',
  date:                'Дата',
  reason:              'Причина',
  deliveryAddress:     'Адрес доставки',
  recipientName:       'Имя получателя',
  recipientPhone:      'Телефон получателя',
  deliveryDate:        'Дата доставки',
  deliveryTime:        'Время доставки',
  courierTime:         'Время курьера',
  assignedDriver:      'Назначенный водитель',
  deliveryFee:         'Стоимость доставки',
  driverInstructions:  'Инструкции водителю',
  deliveryMethod:      'Способ доставки',
  driverPayout:        'Выплата водителю',
  deliveredAt:         'Доставлено',
  month:               'Месяц',
  channel:             'Канал',
  amount:              'Сумма',
  address:             'Адрес',
  importantDate:       'Важная дата',
  importantDateLabel:  'Название важной даты',
  poNumber:            'Номер заказа поставщику',
  createdDate:         'Дата создания',
  plannedDate:         'Плановая дата',
  poId:                'ID заказа поставщику',
  quantityNeeded:      'Нужно (шт.)',
  quantityFound:       'Найдено (шт.)',
  costPrice:           'Цена закупки',
  hours:               'Часы',
  hourlyRate:          'Почасовая ставка',
  bonus:               'Бонус',
  deduction:           'Удержание',
  deliveryCount:       'Количество доставок',
};

// English field labels — same keys as FIELD_LABELS. Fields not listed fall
// back to the raw field name (same as the RU map).
const FIELD_LABELS_EN = {
  id:                  'ID',
  orderDate:           'Order date',
  requiredBy:          'Required by',
  status:              'Status',
  deliveryType:        'Fulfilment type',
  source:              'Source',
  paymentStatus:       'Payment status',
  paymentMethod:       'Payment method',
  price:               'Price',
  customerId:          'Customer ID',
  name:                'Name',
  phone:               'Phone',
  segment:             'Segment',
  orderId:             'Order ID',
  stockItemId:         'Stock item ID',
  quantity:            'Quantity',
  sellPrice:           'Sell price',
  flowerName:          'Flower name',
  colour:              'Colour',
  type:                'Type',
  purchaseDate:        'Purchase date',
  supplier:            'Supplier',
  stockId:             'Stock item ID',
  stockAirtableId:     'Airtable stock ID',
  quantityPurchased:   'Qty purchased',
  pricePerUnit:        'Price per unit',
  notes:               'Notes',
  date:                'Date',
  reason:              'Reason',
  deliveryAddress:     'Delivery address',
  recipientName:       'Recipient name',
  recipientPhone:      'Recipient phone',
  deliveryDate:        'Delivery date',
  deliveryTime:        'Delivery time',
  courierTime:         'Courier time',
  assignedDriver:      'Assigned driver',
  deliveryFee:         'Delivery fee',
  driverInstructions:  'Driver instructions',
  deliveryMethod:      'Delivery method',
  driverPayout:        'Driver payout',
  deliveredAt:         'Delivered at',
  month:               'Month',
  channel:             'Channel',
  amount:              'Amount',
  address:             'Address',
  importantDate:       'Important date',
  importantDateLabel:  'Important date label',
  poNumber:            'PO number',
  createdDate:         'Created date',
  plannedDate:         'Planned date',
  poId:                'PO ID',
  quantityNeeded:      'Qty needed',
  quantityFound:       'Qty found',
  costPrice:           'Cost price',
  hours:               'Hours',
  hourlyRate:          'Hourly rate',
  bonus:               'Bonus',
  deduction:           'Deduction',
  deliveryCount:       'Delivery count',
};

// Field names that look like a date/timestamp despite not containing "date".
const DATE_FIELD_OVERRIDES = new Set(['deliveredAt']);

// Coarse type hint for the Explorer's filter control, derived from the
// field name. Order matters: date/id checks run before the generic number
// bucket so e.g. `deliveryCount` (a number) isn't mistaken for an id.
function inferFieldType(fieldName) {
  const lower = fieldName.toLowerCase();
  if (lower.includes('date') || DATE_FIELD_OVERRIDES.has(fieldName)) return 'date';
  if (fieldName === 'id' || lower.endsWith('id')) return 'id';
  const numberHints = ['quantity', 'qty', 'price', 'hours', 'rate', 'bonus', 'deduction', 'amount', 'count', 'fee', 'payout'];
  if (numberHints.some(hint => lower.includes(hint))) return 'number';
  return 'text';
}

function fieldLabel(fieldName) {
  return FIELD_LABELS[fieldName] || fieldName;
}

function fieldLabelEn(fieldName) {
  return FIELD_LABELS_EN[fieldName] || fieldName;
}

/**
 * describeSchema — projects SCHEMA (dataQueryPack.js) into a UI-safe
 * descriptor consumed by the Explorer front-end. Returns plain, JSON-
 * serializable data only (no Drizzle column objects, no functions).
 *
 * @returns {{ entities: Array<{
 *   key: string,
 *   label: string,
 *   labelEn: string,
 *   softDelete: boolean,
 *   fields: Array<{ name: string, key: string, label: string, labelEn: string, type: string }>,
 *   drills: Array<{ join: string, to: string, label: string, labelEn: string, cardinality: string, localKey: string, foreignField: string }>,
 * }> }}
 */
export function describeSchema() {
  const entities = Object.entries(SCHEMA).map(([key, entityDef]) => {
    const fields = Object.entries(entityDef.fields).map(([fieldName, fieldDef]) => ({
      name:  fieldName,
      // Runtime row key (Drizzle jsKey) — how a plain query_records select
      // returns this column. Falls back to the model name if the reverse
      // lookup misses (defensive; shouldn't happen for allow-listed columns).
      key:     runtimeKeyFor(entityDef.table, fieldDef.col) || fieldName,
      label:   fieldLabel(fieldName),
      labelEn: fieldLabelEn(fieldName),
      type:    inferFieldType(fieldName),
    }));

    const drills = Object.entries(entityDef.joins || {}).map(([joinName, joinDef]) => ({
      join:        joinName,
      to:          joinDef.to,
      label:       `Показать: ${ENTITY_LABELS[joinDef.to] || joinDef.to}`,
      labelEn:     `Show: ${ENTITY_LABELS_EN[joinDef.to] || joinDef.to}`,
      cardinality: joinDef.cardinality,
      // Seed data for a single-hop drill query (ADR-0010): read the clicked
      // row's value at `localKey`, then filter the target entity's
      // `foreignField` by it. Both are derived from the SCHEMA join columns.
      localKey:     runtimeKeyFor(entityDef.table, joinDef.localCol) || null,
      foreignField: modelFieldFor(SCHEMA[joinDef.to], joinDef.foreignCol) || null,
    }));

    return {
      key,
      // SQL table name — how a deep-join (chain) query nests this entity's
      // columns in a joined row (Drizzle keys nested objects by table name,
      // which diverges from the SCHEMA key, e.g. `purchases` → `stock_purchases`).
      // The Explorer grid reads chain cells via row[table][field.key].
      table:      getTableName(entityDef.table),
      label:      ENTITY_LABELS[key] || key,
      labelEn:    ENTITY_LABELS_EN[key] || key,
      softDelete: Boolean(entityDef.softDeleteCol),
      fields,
      drills,
    };
  });

  return { entities };
}
