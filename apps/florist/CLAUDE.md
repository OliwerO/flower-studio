# Florist App — CLAUDE.md

Tablet/phone app for florists (and the owner on mobile). Target: iPad 768px+, but works on phone too. The owner logs in with her PIN and gets the same daily-task control as the dashboard.

## Design Principle
The florist should see all relevant information at a glance — what to prepare next, what's running low, what deliveries are pending — without digging through menus. Every screen answers: "what do I do now?"

## Pages (src/pages/)
| Page | Route | Who | Purpose |
|------|-------|-----|---------|
| LoginPage | /login | all | 4-digit PIN entry with numpad |
| OrderListPage | /orders | all | Today's worklist — active/completed tabs, status filters, owner dashboard alerts |
| OrderDetailPage | /orders/:id | all | Full-page order detail with inline editing, status transitions, bouquet editor. Owner can also delete the order — both Cancellation and Deletion flow through `useOrderTerminationFlow` + `OrderTerminationConfirm` from shared. |
| NewOrderPage | /orders/new | all | 4-step wizard: Customer → Bouquet → Details → Review. AI text import shortcut. |
| StockPanelPage | /stock | all | Inventory view with search, sort, filter, adjust, write-off, receive. Under `STOCK_Y_MODEL` a **Flat ⇄ By type** layout toggle (persisted `blossom-florist-stock-flat`, **default Flat/ungrouped**): Flat = one VarietyListItem row per Variety; a compact **sort pill cycles A–Z (default) → Longest in stock → Stock level** (persisted `blossom-florist-stock-sort`). By type = the TypeGroupHeader-grouped list. Both share `renderVariety`. Rows pass `showHeaderTrace={false}` — no per-row trace icon; trace opens via tap-to-expand → **Trace**. Tapping an order inside a trace opens the shared `OrderQuickViewModal` popup (over the trace, so you keep your place) instead of navigating to `/orders/:id`. A **Filters** pill opens `StockFilterDrawer` (bottom-sheet) — Variety-level filters (Type / colour·cultivar / status short·tight·free / net range) via the shared `varietyFilters` util; applies to both Flat + By-type. Owner can inline-edit **Reorder Threshold + Lot Size** per Variety in the tap-to-expand body (bulk-patches every batch). Negative/Low/Slow pills + search + hide-zero apply in both. Legacy flat StockItem list when the flag is off. |
| StockEvaluationPage | /stock-evaluation | all | Quality inspection of incoming PO deliveries (accept/write-off per line). Substitute Type/Colour picker pre-fills from the shopping-entry classification (#2), still editable. |
| PurchaseOrderPage | /purchase-orders | owner | PO management — create from negative stock, assign drivers, track lifecycle |
| ShoppingSupportPage | /shopping-support | owner | Real-time supervision of active PO shopping runs (SSE + polling). Alt-flower block has Type/Colour datalists so the owner classifies the substitute Variety at entry (#2 → persists as `Alt Type`/`Alt Colour`, threads into evaluation). |
| FloristHoursPage | /hours | all | Florists log time windows; owner sees monthly payroll summary |
| DaySummaryPage | /day-summary | owner | Quick mobile dashboard — revenue, order counts, low stock, unpaid orders |
| BouquetsPage | /bouquets | all | Wix storefront bouquet catalog — active/price/category/key-flower/product-type/lead-time/qty editing, name + PL/RU/UK translation editor (shared `ProductTranslationEditor`), category filter, sync-status indicator, Wix push/pull. Owner manages names from here OR the dashboard (parity, ADR-0008). |
| PremadeBouquetCreatePage | /bouquets/new | owner | Create / edit premade bouquet template (recipe of stock items) |
| CustomerListPage | /customers | all | Customer search + segmentation list |
| CustomerDetailPage | /customers/:id | all | Customer profile + order history |
| WasteLogPage | /waste | owner | Stock-loss entry log by reason |
| SubstituteReconciliationPage | /reconcile | owner | Reconcile substitutions made during PO shopping |
| ~~AssistantPage~~ | ~~`/assistant`~~ | owner | Removed — replaced by the shared `AskBlossomLauncher` FAB (`bottom-36 right-5`) rendered owner-only in `App.jsx` `Layout`. Sits at `bottom-36` (not `bottom-20`) to stack **above** the OrderListPage "Новый заказ" FAB (`bottom-20 right-5 z-50`), which would otherwise paint over it on `/orders`; **`right-5` matches that FAB so both circles line up vertically** (was `right-4` → 4px off, fixed). The FAB is a **brand gradient** circle with the **"Blossom bubble"** flower-AI mark (chat bubble + bloom). Opens the same `AskBlossomPanel` as the dashboard. |

## Key Components (src/components/)
| Component | Purpose |
|-----------|---------|
| OrderCard.jsx | Expandable order card — inline status/payment editing, bouquet editor, delivery fields. Largest component (1300+ L — split candidate; uses `OrderCardSummary.jsx` + `OrderCardExpanded.jsx`). Order Cancellation flows through `useOrderTerminationFlow` + `OrderTerminationConfirm` from shared (no inline handler). |
| OrderFilterDrawer.jsx | Mobile bottom-sheet filter drawer for the order list. Uses shared `Sheet` + the shared `orderFilters` model (`EMPTY_ORDER_FILTER`, `buildOrderQueryParams`, `orderMatchesClientFilter`, `activeOrderFilterCount`, `clearOrderFilter`). Mirrors the dashboard `OrdersTab.jsx` per-column popovers. Wired into `OrderListPage.jsx` — the Filters button + active-count badge appear next to the status sub-filter tabs in Active and Completed views. |
| StockFilterDrawer.jsx | Mobile bottom-sheet filter drawer for the Y-model By-Variety Stock list (E1b). Uses shared `Sheet` + the shared `varietyFilters` model (Variety-level: Type / colour·cultivar / status short·tight·free / net range). Opened by the `Filters (n)` pill in `StockPanelPage.jsx`; applies to both Flat + By-type views. Stock analogue of `OrderFilterDrawer`. |
| BouquetEditor.jsx | Flower catalog search + cart with qty controls, cost/margin visibility, price override |
| StockItem.jsx | Single stock row with write-off dialog, adjust buttons, effective-stock display via `getEffectiveStock` |
| BottomNav.jsx | Tab bar — role-based tabs (florist sees Hours; owner sees Shopping) |
| DatePicker.jsx | iOS-style calendar dropdown (portal-rendered). Duplicated in dashboard — TODO move to shared. |
| TimePicker.jsx | Time slot picker that consumes `getAvailableSlots` from shared. |
| TextImportModal.jsx | AI text parsing — paste customer message, get structured order draft |
| ReceiveStockForm.jsx | Record incoming supplier deliveries with batch tracking. |
| PendingArrivalsSection.jsx | Pending PO line summary on stock panel — surfaces in-flight purchases. |
| PremadeBouquetCard.jsx | Card for premade bouquet templates. |
| HelpPanel.jsx | 30+ bilingual Q&As — pulled in via global help button. |
| InlineEdit.jsx | Click-to-edit text primitive. |
| Skeleton.jsx, Toast.jsx | Loading + toast renderers (Toast wraps shared). |
| CustomerDetailView / CustomerHeader / CustomerListPane / CustomerTimeline / CustomerFilterSheet / KeyPersonChips | CRM detail composition — mirrors dashboard CRM via shared shape. |
| `bouquets/`, `steps/`, `waste/` | Sub-folders for premade builder, NewOrder wizard steps (Step1-4), and waste log helpers. |

## State & Data Flow
- **Auth/Toast/Language**: shared contexts from `packages/shared/`
- **Theme**: local ThemeContext (dark mode with system detection + localStorage)
- **Config**: `useConfigLists` hook — single API call, module-level cache, returns suppliers/categories/drivers/rates
- **Notifications**: `useNotifications` hook — SSE listener for new orders + stock evaluation events (plays sound)
- **API client**: re-exported from `packages/shared/api/client.js` — axios with auto-attached PIN

## UI Conventions
- iOS-style: glass morphism (`.glass-nav`, `.glass-card`), rounded-2xl cards, SF Pro font stack
- Status badges: color-coded per status (indigo=New, amber=Ready, sky=Out for Delivery, emerald=Delivered)
- Tailwind only — no custom CSS files
- Dark mode: `darkMode: 'class'` in Tailwind config
- Inline editing pattern: `defaultValue` + `onBlur` → patch API call (no separate edit mode)

## Florist ↔ Dashboard Feature Parity (IMPORTANT)
The owner uses this app on mobile for the same daily tasks she does on the dashboard. **Every feature added here must also be added to the dashboard app** (and vice versa). See root CLAUDE.md for the full mapping of parallel files.

## Important Patterns
- **OrderCard vs OrderDetailPage**: OrderCard is the collapsed/expanded card in the list. OrderDetailPage is the full-page view. Both can edit orders — keep them in sync when adding features.
- **Stock filtering**: dated batch items (e.g. "Rose (14.Mar.)") at qty=0 are hidden from bouquet pickers but visible in stock management. Check `Step2Bouquet.jsx` and `useOrderEditing.js`.
- **Pickup→Delivery conversion**: creates a delivery record on-the-fly. After conversion, delivery fields (address, recipient, phone, fee) must be editable — they're blank and need filling.

## Skill Triggers

See root CLAUDE.md "Skill Quick-Reference" for the full table. Florist-specific defaults:
- **Bug or unexpected UI behavior** → `diagnose` before proposing a fix
- **New feature that touches OrderCard + OrderDetailPage** → note in brainstorming that dashboard `OrderDetailPanel.jsx` must receive the same change (cross-app parity rule)
