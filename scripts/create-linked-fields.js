// One-time setup script — creates the 4 linked record fields that CSV import cannot create.
// Run once from flower-studio root: node scripts/create-linked-fields.js

const API_KEY  = process.env.AIRTABLE_API_KEY;
const BASE_ID  = process.env.AIRTABLE_BASE_ID || 'appM8rLfcE9cbxduZ';

if (!API_KEY) {
  console.error('Missing AIRTABLE_API_KEY. Run with: AIRTABLE_API_KEY=pat_xxx node scripts/create-linked-fields.js');
  process.exit(1);
}

const TABLES = {
  ORDERS:       'tbljPQgczS1zglRE3',
  ORDER_LINES:  'tbl9D9F1uf1hFih39',
  CUSTOMERS:    'tblMK6MEO7jqCJAUV',
  STOCK:        'tblMJAP2erGLZzZsR',
  DELIVERIES:   'tbl6aEZ2fkUZY9QOo',
};

const FIELDS_TO_CREATE = [
  {
    tableId:     TABLES.ORDERS,
    tableName:   'App Orders',
    fieldName:   'Customer',
    linkedTable: TABLES.CUSTOMERS,
  },
  {
    tableId:     TABLES.ORDER_LINES,
    tableName:   'Order Lines',
    fieldName:   'Order',
    linkedTable: TABLES.ORDERS,
  },
  {
    tableId:     TABLES.ORDER_LINES,
    tableName:   'Order Lines',
    fieldName:   'Stock Item',
    linkedTable: TABLES.STOCK,
  },
  {
    tableId:     TABLES.DELIVERIES,
    tableName:   'Deliveries',
    fieldName:   'Linked Order',
    linkedTable: TABLES.ORDERS,
  },
];

async function createField(tableId, fieldName, linkedTableId) {
  const url = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      name: fieldName,
      type: 'multipleRecordLinks',
      options: { linkedTableId },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data));
  return data;
}

async function main() {
  console.log('Creating linked record fields in Airtable...\n');

  for (const f of FIELDS_TO_CREATE) {
    process.stdout.write(`  ${f.tableName} → "${f.fieldName}" ... `);
    try {
      await createField(f.tableId, f.fieldName, f.linkedTable);
      console.log('✓ created');
    } catch (err) {
      if (err.message.includes('duplicate') || err.message.includes('already exists')) {
        console.log('⟳ already exists (skipped)');
      } else {
        console.log(`✗ FAILED: ${err.message}`);
      }
    }
  }

  console.log('\nDone. You can now submit orders from the florist app.');
}

main();
