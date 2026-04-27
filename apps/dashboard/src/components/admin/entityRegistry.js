// Admin tab entity registry — declarative metadata for each entity that
// has been cutover to Postgres. Phase 3 registers 'stock'; future phases
// add 'order' / 'customer'.
//
// Each entry describes how the generic AdminTab table renders the entity:
// which fields show as columns, which are inline-editable, the API path,
// and a humanised display name (RU + EN). Today (Phase 3) the AdminTab
// only lists the entities — column-level inline-edit ships once the audit
// trail backed by these endpoints has been validated against shadow-write
// parity for ≥1 week.

const ENTITIES = {
  stock: {
    path:    'stock',                                     // /api/admin/stock
    labelEn: 'Stock',
    labelRu: 'Склад',
    primaryKey: 'id',
    columns: [
      { key: 'display_name',      label: 'Name',       editable: true  },
      { key: 'category',          label: 'Category',   editable: true  },
      { key: 'current_quantity',  label: 'Qty',        editable: true,  type: 'number' },
      { key: 'current_cost_price', label: 'Cost',      editable: true,  type: 'number' },
      { key: 'current_sell_price', label: 'Sell',      editable: true,  type: 'number' },
      { key: 'supplier',          label: 'Supplier',   editable: true  },
      { key: 'reorder_threshold', label: 'Threshold',  editable: true,  type: 'number' },
      { key: 'active',            label: 'Active',     editable: true,  type: 'boolean' },
      { key: 'airtable_id',       label: 'Airtable ID', editable: false },
      { key: 'updated_at',        label: 'Updated',    editable: false, type: 'datetime' },
      { key: 'deleted_at',        label: 'Deleted',    editable: false, type: 'datetime' },
    ],
  },
};

export function listEntities() {
  return Object.entries(ENTITIES).map(([key, def]) => ({ key, ...def }));
}

export function getEntity(key) {
  return ENTITIES[key];
}
