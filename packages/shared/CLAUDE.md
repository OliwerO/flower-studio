# Shared Package — CLAUDE.md

Cross-app utilities shared by all three frontend apps. Anything used by 2+ apps belongs here.

## Structure
```
api/client.js         → Axios instance with auto-attached PIN header (VITE_BACKEND_URL)
context/
  AuthContext.jsx     → PIN, role, login/logout — wraps all apps
  ToastContext.jsx    → showToast(msg, type) — success/error toasts
  LanguageContext.jsx → EN/RU toggle, translation sync
components/
  ErrorBoundary.jsx   → React error boundary with fallback UI
  Toast.jsx           → Toast notification renderer
hooks/
  useOrderEditing.js  → Shared bouquet editing logic (stock filtering, line management)
  useOrderPatching.js → Shared order/delivery PATCH helpers (patchOrder, patchDelivery)
utils/
  parseBatchName.js   → Extracts date from batch names like "Rose (14.Mar.)"
  stockName.jsx       → Formats stock display names with age/date labels
  timeSlots.js        → Time slot generation with lead-time filtering
```

## Rules
- New utilities here **must** have tests (see root CLAUDE.md Testing Rules)
- Keep dependencies minimal — this package is imported by all three apps
- No app-specific logic — if it's only used by one app, it belongs in that app
