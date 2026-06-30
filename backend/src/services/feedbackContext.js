// backend/src/services/feedbackContext.js
//
// Static per-area context pack for the feedback assistant.
// Gives Haiku a short domain summary so it can infer the screen and terminology
// instead of asking the reporter. Code-RAG (issue #457) is the deeper version —
// the seam is designed so RAG plugs in here without rework.

const AREA_CONTEXTS = {
  dashboard: `App: Dashboard (desktop, owner-only).
Key screens: Today (Kanban board), Orders (list + column filters + inline edit + margin %), New Order (4-step wizard), Stock (inventory + Variety view), Customers (CRM + RFM), Financial (analytics, Recharts), Products (Wix push/pull), Settings, Admin, Issues (GitHub proxy).
Key concepts: Order (delivery or pickup), Delivery (physical run), Stock Item / Batch / Demand Entry, Stock Order (procurement), Write-off, Florist (builds bouquets), Driver (delivers), Owner (full access), Margin dot (green ≥55% / amber 40–54% / red <40%).
Common issues: order status transitions, stock adjustments, Wix product sync, payment status display, delivery assignment, margin calculations, filter state.`,

  florist: `App: Florist app (tablet/phone — owner + florists).
Key screens: Order List (today's worklist, active/completed tabs), Order Detail (edit/status/bouquet), New Order (4-step wizard), Stock Panel (inventory), Purchase Orders (PO lifecycle), Bouquets (Wix catalog), Hours, Day Summary.
Key concepts: Order, Delivery, Bouquet Editor, Stock Item / Batch, Stock Order (Draft→Sent→Shopping→Reviewing→Evaluating→Complete), Write-off, Florist, Driver, BottomNav tabs.
Common issues: order creation, bouquet composition, stock receive, PO evaluation, florist hours logging, status revert, missing fields after Pickup→Delivery conversion.`,

  delivery: `App: Delivery app (phone — drivers only).
Key screens: Deliveries list, PO shopping runs, address navigation.
Key concepts: Delivery (physical run assigned to a driver), PO Shopping Run, Google Maps / Waze navigation links, delivery status (Out for Delivery → Delivered).
Common issues: delivery status updates, navigation not opening, assigned order details missing.`,
};

const FALLBACK_CONTEXT = `App: Blossom — flower studio operational platform (Krakow, Poland).
Roles: Owner (full access — dashboard + florist app), Florist (orders + stock), Driver (deliveries).
Key concepts: Order, Delivery, Stock Item / Batch, Stock Order (PO), Bouquet, Write-off.`;

/**
 * Returns a short domain-context string for the given appArea.
 * Appended to the feedback assistant system prompt so Haiku infers screen/state
 * instead of asking the reporter. issue #457 (code-RAG) will plug in here later.
 * @param {string|null|undefined} appArea
 * @returns {string}
 */
export function getAreaContext(appArea) {
  return AREA_CONTEXTS[appArea] ?? FALLBACK_CONTEXT;
}
