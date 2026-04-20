# Dashboard App — CLAUDE.md

Desktop owner control panel (1024px+). Single page with tab navigation — each tab is a different operational view.

## Design Principle
The owner needs two things: (1) daily operational control — same visibility as the florist, plus the ability to manage everything from orders to customers to stock; (2) strategic oversight — finances, analytics, product management, settings. Every piece of data should be trustworthy and actionable.

## Tabs (all in src/components/, loaded by DashboardPage.jsx)
| Tab | Component | Purpose |
|-----|-----------|---------|
| Today | DayToDayTab.jsx | Kanban board of today's orders, pending deliveries, low stock alerts, unpaid orders. Cross-tab navigation to drill into details. |
| Orders | OrdersTab.jsx | Full order list with filters (status, date, source, payment). Opens OrderDetailPanel for inline editing. |
| New Order | NewOrderTab.jsx | 4-step order creation wizard (same steps as florist: Customer → Bouquet → Details → Review). |
| Stock | StockTab.jsx | Inventory management with optimistic qty adjustments, write-off, visibility toggles, stock receive form. |
| Customers | CustomersTab.jsx | CRM — customer list with segmentation (RFM scoring), detail panel with order history, editable fields. |
| Financial | FinancialTab.jsx | Recharts-powered analytics: revenue, margins, top products, waste, source ROI, supplier scorecard. Lazy-loaded. |
| Products | ProductsTab.jsx | Wix product sync — pull/push products, manage categories (permanent/seasonal/auto), translations. |
| Settings | SettingsTab.jsx | Delivery zones/fees, driver config, florist rates, payment methods, order sources, marketing spend, stock loss log. |

## Key Components
| Component | Purpose |
|-----------|---------|
| OrderDetailPanel.jsx | Side panel for editing an order — status, payment (partial support), bouquet, delivery, cost/margin. |
| StockOrderPanel.jsx | PO management — create, send, edit lines, evaluate. Same PO lifecycle as florist PurchaseOrderPage. |
| CustomerDetailView.jsx | Customer detail v2.0 — split-view right pane. Composes CustomerHeader, stat strip, inline-editable profile grid, KeyPersonChips, CustomerTimeline (merged legacy + app orders with expandable rows exposing every raw field). |
| CustomerDrawer.jsx | Narrow-viewport (<1280px) slide-over wrapper around CustomerDetailView — replaces the inline right pane when the desktop split doesn't fit. |
| KanbanBoard.jsx | Drag-style board for Today tab — orders grouped by status columns. |
| StockReceiveForm.jsx | Record incoming supplier deliveries with batch tracking. |
| BouquetSection.jsx / DeliverySection.jsx | Sub-sections of OrderDetailPanel for bouquet editing and delivery info. |

## Dashboard ↔ Florist Feature Parity (IMPORTANT)
The owner uses both apps — dashboard on desktop, florist app on mobile. **Every feature added here must also be added to the florist app** (and vice versa). If adding filters, inline editors, status actions, or any user-facing behavior, implement in both. See root CLAUDE.md for the full mapping of parallel files.

## State & Data Flow
- Tab selection persisted in localStorage (`dashboard_tab`)
- Cross-tab navigation: `navigateTo({ tab, filter })` passes filter state between tabs (e.g., clicking a low-stock alert opens Stock tab filtered)
- `filterKey` counter forces full remount on cross-tab navigation to avoid stale filter state
- FinancialTab lazy-loaded (Recharts ~160KB) — only mounted on first visit

## Settings Sections (src/components/settings/)
DeliveryZonesSection, DriverSettingsSection, MarketingSpendSection, RateEditors, StorefrontCategoriesSection, StockLossSection — each manages a specific config domain via `POST /settings`.
