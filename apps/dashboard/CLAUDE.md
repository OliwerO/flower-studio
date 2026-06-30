# Dashboard App — CLAUDE.md

Desktop owner control panel (1024px+). Single page with tab navigation — each tab is a different operational view.

## Design Principle
The owner needs two things: (1) daily operational control — same visibility as the florist, plus the ability to manage everything from orders to customers to stock; (2) strategic oversight — finances, analytics, product management, settings. Every piece of data should be trustworthy and actionable.

## Tabs (all in src/components/, loaded by DashboardPage.jsx)
| Tab | Component | Purpose |
|-----|-----------|---------|
| Today | DayToDayTab.jsx | Kanban board of today's orders, pending deliveries, low stock alerts, unpaid orders. Cross-tab navigation to drill into details. |
| Orders | OrdersTab.jsx | Full order list. **Click a column header to sort** by it (asc ⇄ desc on repeat click; brand ▲/▼ on the active column, faint ⇅ on hover for idle sortable columns); a **funnel button** beside each header opens that column's filter popover (# / Order date / Customer / Bouquet / Status+Payment / Type / Fulfilment date / Total). Fulfilment column split into Type (🚗/🏪) + date cells. A **Маржа** column shows each order's profit margin as a coloured dot + % (green ≥55% / amber 40–54% / red <40% / gray = no flower cost) — profit health, NOT payment status. Date inputs use custom DatePicker (day-month-year). Shared `orderFilters` util drives filter state; only server fields refetch — client text/price filters apply in memory (no per-keystroke fetch). Ticking orders shows a selection-totals bar (Sales / Paid / Outstanding / Profit+margin% / Avg). Opens OrderDetailPanel for inline editing. |
| New Order | NewOrderTab.jsx | 4-step order creation wizard (same steps as florist: Customer → Bouquet → Details → Review). **No top nav pill** — launched from the bottom-right speed-dial FAB in `DashboardPage.jsx` (matches the florist `OrderListPage` FAB): 📋 paste-import (→ `TextImportModal` → AI parse → prefill via `initialFilter.importDraft`) / 💐 premade (→ `PremadeBouquetCreateModal`) / ✏️ manual (→ `navigateTo({tab:'newOrder'})`). The `newOrder` tab content is still rendered; only its pill was removed. |
| Stock | StockTab.jsx | Inventory management with optimistic qty adjustments, write-off, visibility toggles, stock receive form. Uses `getEffectiveStock` from shared. Y-model collapsed Variety list under `STOCK_Y_MODEL` (TypeGroupHeader + VarietyListItem + BatchTracePanel inline from shared); legacy flat list when flag off. |
| Customers | CustomersTab.jsx | CRM — customer list with segmentation (RFM scoring), detail panel with order history, editable fields. |
| Financial | FinancialTab.jsx | Recharts-powered analytics: revenue, margins, top products, waste, source ROI, supplier scorecard. Lazy-loaded. |
| Products | ProductsTab.jsx | Wix product sync — pull/push products, manage categories (permanent/seasonal/auto), translations. |
| Settings | SettingsTab.jsx | Delivery zones/fees, driver config, florist rates, payment methods, order sources, marketing spend, stock loss log. |
| Admin | AdminTab.jsx | Owner-only — Postgres migration health, parity dashboards (stock, soon orders), audit log viewer. Powers the shadow-week verification. |
| Variety Backfill | VarietyBackfillTab.jsx | Owner-only pre-cutover UI: fills Type/Colour/Size/Cultivar on stock rows where type_name IS NULL. Status banner, autocomplete inputs, cultivar prefill, bulk-edit panel. |
| Issues | IssuesTab.jsx | In-app GitHub issue tracker (owner-only). Browse open/closed issues, set priority (`priority:*` labels), manage labels, comment, close/reopen, create new issues. Backed by `GET/POST/PATCH /api/issues` (proxy over GitHub REST). Dashboard-only — not in the florist app (owner's strategic-oversight surface, like Financial/Admin). |
| ~~Assistant~~ | ~~AssistantTab.jsx~~ | Removed — replaced by the shared `AskBlossomLauncher` FAB mounted in `DashboardPage.jsx`. Stacked at `bottom-24 right-6` (above the new-order FAB at `bottom-6 right-6`, same as the florist app) → opens full right-side drawer on desktop / bottom sheet on mobile. |

## Key Components
| Component | Purpose |
|-----------|---------|
| OrderDetailPanel.jsx | Side panel for editing an order — status, payment (partial support), bouquet, delivery, cost/margin. (~1250 L — split candidate.) Order Cancellation + Owner Deletion flow through `useOrderTerminationFlow` + `OrderTerminationConfirm` from shared (no inline handlers). |
| StockOrderPanel.jsx | PO management — create, send, edit lines, evaluate. Same PO lifecycle as florist PurchaseOrderPage. (~1390 L — split candidate.) |
| CustomerDetailView.jsx | Customer detail v2.0 — split-view right pane. Composes CustomerHeader, stat strip, inline-editable profile grid, KeyPersonChips, CustomerTimeline (merged legacy + app orders with expandable rows exposing every raw field). |
| CustomerDrawer.jsx | Narrow-viewport (<1280px) slide-over wrapper around CustomerDetailView — replaces the inline right pane when the desktop split doesn't fit. |
| CustomerFilterBar.jsx / CustomerListPane.jsx | CRM filtering + list rendering primitives shared with the florist app via shared `customerFilters` util. |
| ReconciliationSection.jsx | Owner reconciliation of PO substitutions inside StockOrderPanel. |
| KanbanBoard.jsx | Drag-style board for Today tab — orders grouped by status columns. |
| StockReceiveForm.jsx | Record incoming supplier deliveries with batch tracking. |
| BouquetSection.jsx / DeliverySection.jsx | Sub-sections of OrderDetailPanel for bouquet editing and delivery info. |
| PremadeBouquetCreateModal.jsx / PremadeBouquetList.jsx | Premade bouquet template editor + listing. |
| TextImportModal.jsx | AI paste-import (mirror of florist's) — opened from the new-order FAB; `POST /intake/parse` → draft → `NewOrderTab` prefill. |
| TopProductsWidget.jsx / SourceChart.jsx / SummaryCard.jsx / Pills.jsx | Financial-tab building blocks. |
| InlineEdit.jsx / DatePicker.jsx / Skeleton.jsx / Toast.jsx / HelpPanel.jsx | UI primitives. DatePicker is duplicated with florist — TODO move to shared. |
| order/ColumnFilterPopover.jsx | Generic header **funnel-button** popover shell for per-column filters. Props: `active` (fills the funnel + shows a dot), `title` (popover heading + aria-label), `align` ('left' \| 'right' — right-anchor the panel on right-aligned columns so it doesn't spill past the viewport), `children` (filter controls). Consumed by OrdersTab for all 8 column header popovers; the header label itself is a separate sort control (SortHeader). |
| `admin/`, `order/`, `products/`, `settings/`, `steps/` | Sub-folders for AdminTab panels, OrderDetailPanel sections, Products tab subpanels, Settings sections, NewOrder wizard steps. |

## Dashboard ↔ Florist Feature Parity (IMPORTANT)
The owner uses both apps — dashboard on desktop, florist app on mobile. **Every feature added here must also be added to the florist app** (and vice versa). If adding filters, inline editors, status actions, or any user-facing behavior, implement in both. See root CLAUDE.md for the full mapping of parallel files.

## State & Data Flow
- Tab selection persisted in localStorage (`dashboard_tab`)
- Cross-tab navigation: `navigateTo({ tab, filter })` passes filter state between tabs (e.g., clicking a low-stock alert opens Stock tab filtered)
- `filterKey` counter forces full remount on cross-tab navigation to avoid stale filter state
- FinancialTab lazy-loaded (Recharts ~160KB) — only mounted on first visit

## Settings Sections (src/components/settings/)
DeliveryZonesSection, DriverSettingsSection, MarketingSpendSection, RateEditors, StorefrontCategoriesSection, StockLossSection — each manages a specific config domain via `POST /settings`.

## Skill Triggers

See root CLAUDE.md "Skill Quick-Reference" for the full table. Dashboard-specific defaults:
- **Bug or unexpected UI behavior** → `diagnose` before proposing a fix
- **New feature that touches OrderDetailPanel, StockTab, or StockOrderPanel** → note in brainstorming that the parallel florist-app component must receive the same change (cross-app parity rule)
