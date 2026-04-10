# Florist App — CLAUDE.md

Tablet/phone app for florists (and the owner on mobile). Target: iPad 768px+, but works on phone too. The owner logs in with her PIN and gets the same daily-task control as the dashboard.

## Design Principle
The florist should see all relevant information at a glance — what to prepare next, what's running low, what deliveries are pending — without digging through menus. Every screen answers: "what do I do now?"

## Pages (src/pages/)
| Page | Route | Who | Purpose |
|------|-------|-----|---------|
| LoginPage | /login | all | 4-digit PIN entry with numpad |
| OrderListPage | /orders | all | Today's worklist — active/completed tabs, status filters, owner dashboard alerts |
| OrderDetailPage | /orders/:id | all | Full-page order detail with inline editing, status transitions, bouquet editor |
| NewOrderPage | /orders/new | all | 4-step wizard: Customer → Bouquet → Details → Review. AI text import shortcut. |
| StockPanelPage | /stock | all | Inventory view with search, sort, filter, adjust, write-off, receive |
| StockEvaluationPage | /stock-evaluation | florist | Quality inspection of incoming PO deliveries (accept/write-off per line) |
| PurchaseOrderPage | /purchase-orders | owner | PO management — create from negative stock, assign drivers, track lifecycle |
| ShoppingSupportPage | /shopping-support | owner | Real-time supervision of active PO shopping runs (SSE + polling) |
| FloristHoursPage | /hours | all | Florists log time windows; owner sees monthly payroll summary |
| DaySummaryPage | /day-summary | owner | Quick mobile dashboard — revenue, order counts, low stock, unpaid orders |

## Key Components (src/components/)
| Component | Purpose |
|-----------|---------|
| OrderCard.jsx (47KB) | Expandable order card — inline status/payment editing, bouquet editor, delivery fields. Largest component. |
| BouquetEditor.jsx | Flower catalog search + cart with qty controls, cost/margin visibility, price override |
| StockItem.jsx | Single stock row with write-off dialog, adjust buttons, committed qty tracking |
| BottomNav.jsx | Tab bar — role-based tabs (florist sees Hours; owner sees Shopping) |
| DatePicker.jsx | iOS-style calendar dropdown (portal-rendered) |
| TextImportModal.jsx | AI text parsing — paste customer message, get structured order draft |
| Step1-4 components | Order wizard steps (customer search, bouquet builder, details, review) |

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
