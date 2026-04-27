// Admin tab entity registry — declarative metadata for each entity that
// has been cutover to Postgres. Phase 2.5 ships an empty registry; Phase 3
// adds 'stock', Phase 4 adds 'order' / 'customer', etc.
//
// Each entry describes how the generic AdminTab table renders the entity:
// which fields show as columns, which are inline-editable, the API path,
// and a humanised display name (RU + EN).

const ENTITIES = {
  // Phase 3 will register 'stock' here, e.g.:
  //
  // stock: {
  //   path: 'stock',                                   // /api/admin/stock
  //   labelEn: 'Stock', labelRu: 'Склад',
  //   columns: [
  //     { key: 'display_name',     label: 'Name',     editable: true  },
  //     { key: 'current_quantity', label: 'Qty',      editable: true, type: 'number' },
  //     { key: 'category',         label: 'Category', editable: false },
  //     { key: 'deleted_at',       label: 'Deleted',  editable: false, type: 'datetime' },
  //   ],
  //   primaryKey: 'id',
  // },
};

export function listEntities() {
  return Object.entries(ENTITIES).map(([key, def]) => ({ key, ...def }));
}

export function getEntity(key) {
  return ENTITIES[key];
}
