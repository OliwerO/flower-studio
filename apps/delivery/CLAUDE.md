# Delivery App — CLAUDE.md

Phone-first app for drivers (iPhone 375px+). Two jobs: deliver bouquets to customers, and shop for flowers at the market (PO runs).

## Design Principle
The driver needs to see exactly what to do next with zero ambiguity — where to go, what to bring, who to call. Large touch targets, minimal text input, works one-handed while carrying flowers.

## Pages (src/pages/)
| Page | Route | Purpose |
|------|-------|---------|
| LoginPage | /login | PIN entry — driver role only |
| DeliveryListPage | /deliveries | Today's deliveries grouped by status. Tap to expand details + navigate. |
| StockPickupPage | /stock-pickup | Active PO shopping runs — line-by-line checklist at the market. |

## Key Components (src/components/)
| Component | Purpose |
|-----------|---------|
| DeliveryCard.jsx | Single delivery card — address, recipient, phone (tap-to-call), order contents, status actions |
| DeliverySheet.jsx | Bottom sheet with delivery details, navigation button, delivery result picker |
| DeliveryResultPicker.jsx | Result reporting: Success / Not Home / Wrong Address / Refused / Incomplete |
| MapView.jsx | Leaflet map for delivery navigation + driver GPS pin |
| HelpPanel.jsx | Bilingual Q&A panel (driver-specific) |
| Skeleton.jsx / Toast.jsx | Loading placeholders + toast renderer (wraps shared) |

## Driver Workflows

### Delivery Flow
1. Driver sees today's deliveries (Pending status)
2. Taps delivery → sees address, recipient, phone, order contents, notes
3. Marks "Out for Delivery" (auto-assigns driver name, cascades to order)
4. Navigates via map
5. Marks "Delivered" + selects result (Success/Not Home/etc.)
6. Status cascades back to linked order

### PO Shopping Flow
1. Owner creates PO and sends to driver (PO status: Sent)
2. Driver sees assigned PO on StockPickupPage
3. Checks off items as they shop at the market
4. Marks PO as "Done shopping" (status: Reviewing)
5. Returns to studio for florist evaluation

## Data Flow
- API client from `packages/shared/` with auto-attached PIN
- Driver name attached to all status changes via `req.driverName` (set by auth middleware from PIN)
- SSE listener for real-time PO assignment notifications
