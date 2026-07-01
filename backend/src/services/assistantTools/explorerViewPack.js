// backend/src/services/assistantTools/explorerViewPack.js
//
// Ask Blossom — open_explorer_view signal tool.
// Generalizes ordersViewPack's open_orders_view to ANY entity on the
// query_records allow-list (ADR-0010: Explorer is a read-only second
// front-end on the same query_records engine).
//
// Not a DB read: this handler is pure and synchronous under the hood — it
// only validates the caller's spec against the same allow-list query_records
// uses (via validateSpec, imported from dataQueryPack.js so the two surfaces
// can never drift) and echoes it back so the dashboard can render an
// "Open in Explorer" action. The panel treats this tool's output as an
// action trigger, same convention as ordersViewPack's `view` key — no other
// tool should reuse `view: 'explorer'`.

import { validateSpec } from './dataQueryPack.js';

const DEFAULT_LABEL = 'Данные';

export async function openExplorerViewHandler(input = {}) {
  const { spec, label } = input;

  const v = validateSpec(spec);
  if (!v.ok) return { error: v.error };

  const resolvedLabel = (typeof label === 'string' && label.trim()) ? label.trim() : DEFAULT_LABEL;

  return { view: 'explorer', spec, label: resolvedLabel };
}
