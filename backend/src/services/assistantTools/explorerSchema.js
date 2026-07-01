// backend/src/services/assistantTools/explorerSchema.js
//
// Projects the `query_records` allow-list (SCHEMA in dataQueryPack.js) into a
// UI-safe descriptor for the Explorer front-end (ADR-0010). The descriptor is
// plain, serializable data — it never leaks a Drizzle column object, so the
// Explorer UI can render entity/field pickers and drill buttons without ever
// touching the DB layer directly. One allow-list, two front-ends.

import { SCHEMA } from './dataQueryPack.js';

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

/**
 * describeSchema — projects SCHEMA (dataQueryPack.js) into a UI-safe
 * descriptor consumed by the Explorer front-end. Returns plain, JSON-
 * serializable data only (no Drizzle column objects, no functions).
 *
 * @returns {{ entities: Array<{
 *   key: string,
 *   label: string,
 *   softDelete: boolean,
 *   fields: Array<{ name: string, label: string, type: string }>,
 *   drills: Array<{ join: string, to: string, label: string, cardinality: string }>,
 * }> }}
 */
export function describeSchema() {
  const entities = Object.entries(SCHEMA).map(([key, entityDef]) => {
    const fields = Object.keys(entityDef.fields).map(fieldName => ({
      name:  fieldName,
      label: fieldLabel(fieldName),
      type:  inferFieldType(fieldName),
    }));

    const drills = Object.entries(entityDef.joins || {}).map(([joinName, joinDef]) => ({
      join:        joinName,
      to:          joinDef.to,
      label:       `Показать: ${ENTITY_LABELS[joinDef.to] || joinDef.to}`,
      cardinality: joinDef.cardinality,
    }));

    return {
      key,
      label:      ENTITY_LABELS[key] || key,
      softDelete: Boolean(entityDef.softDeleteCol),
      fields,
      drills,
    };
  });

  return { entities };
}
