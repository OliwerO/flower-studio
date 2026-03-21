# Codebase Review — Flower Studio

**Date:** 2026-03-21
**Scope:** Full codebase analysis — architecture, code quality, future-readiness

---

## Executive Summary

The codebase is well-structured for its current scale (1 owner, 2–4 florists, 2 drivers). The monorepo layout, shared package, rate-limited Airtable access, and stateless PIN auth all make solid sense. However, there are **specific areas where targeted improvements would reduce maintenance cost now** and prevent pain when adding features later.

The recommendations below are ordered by **impact-to-effort ratio** — the first items give the most value for the least work.

---

## 1. STATUS CONSTANTS — Scattered Hardcoded Strings

**Problem:** Status strings (`"New"`, `"Ready"`, `"Delivered"`, `"Cancelled"`, `"In Preparation"`, etc.) are hardcoded across ~60+ locations in both backend routes and frontend components. If a status name ever changes or a new status is added, every file must be touched manually.

**What I'd do differently:**

Create a shared constants module:

```
packages/shared/constants/statuses.js
```

```js
export const ORDER_STATUS = {
  NEW: 'New',
  ACCEPTED: 'Accepted',
  IN_PREPARATION: 'In Preparation',
  READY: 'Ready',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  PICKED_UP: 'Picked Up',
  CANCELLED: 'Cancelled',
};

export const TERMINAL_STATUSES = [ORDER_STATUS.DELIVERED, ORDER_STATUS.PICKED_UP, ORDER_STATUS.CANCELLED];

export const PO_STATUS = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  SHOPPING: 'Shopping',
  REVIEWING: 'Reviewing',
  EVALUATING: 'Evaluating',
  COMPLETE: 'Complete',
};
```

Backend imports directly. Frontends already depend on `@flower-studio/shared`. One source of truth.

**Effort:** Low (1–2 hours)
**Impact:** High — eliminates an entire class of bugs

---

## 2. ROUTE FILE SIZE — orders.js (712 lines), analytics.js (570 lines)

**Problem:** `orders.js` handles GET (listing + enrichment), POST (creation with 5-step orchestration + rollback), PATCH (status transitions), DELETE, and line editing. It's the most complex file and the hardest to reason about.

**What I'd do differently:**

Extract the order creation orchestration into a service:

```
backend/src/services/orderCreation.js
```

This would own the multi-step flow: create order → match stock → create lines → deduct stock → create delivery → rollback on failure. The route handler would just validate input and call `await createOrder(validatedData)`.

Similarly, `analytics.js` (570 lines) does heavy computation (revenue, margins, RFM scoring, trends). The SQL-like aggregation logic belongs in a service, not a controller.

**Effort:** Medium (half a day per file)
**Impact:** High — easier testing, debugging, and future feature additions

---

## 3. DUPLICATE UTILITIES — Not Fully Migrated to Shared Package

**Problem:** Several files exist in both `apps/*/src/utils/` AND `packages/shared/utils/`:

| File | Locations |
|------|-----------|
| `stockName.jsx` | `packages/shared`, `apps/florist`, `apps/dashboard` |
| `DatePicker.jsx` | `apps/florist`, `apps/dashboard` (nearly identical) |
| `guideContent.js` | `apps/florist`, `apps/delivery`, `apps/dashboard` |
| `translations.js` | `apps/florist` (855L), `apps/delivery` (249L), `apps/dashboard` (1247L) |

`stockName.jsx` exists in shared but the app-local copies are still imported in some places. `DatePicker` is duplicated with minor styling differences.

**What I'd do differently:**

- Delete the app-local `stockName.jsx` copies — shared version already exists and is exported
- Move `DatePicker` to shared package with a `className` prop for app-specific styling
- Keep `translations.js` per-app (intentional — each app has different strings) but extract shared keys (statuses, common labels) into `packages/shared/i18n/common.js`

**Effort:** Low
**Impact:** Medium — eliminates sync bugs between copies

---

## 4. NO TESTS — Zero Automated Coverage

**Problem:** The `scripts/` directory has seed scripts and a consistency checker, but there are no unit tests, integration tests, or E2E tests. The BACKLOG lists "Wave 5 (Testing Foundation)" as not started.

**What I'd do differently — pragmatic approach:**

Don't aim for full coverage. Focus tests on the **highest-risk, hardest-to-manually-verify** code:

1. **Order creation orchestration** — the rollback logic is critical and complex
2. **Stock atomic adjustments** — concurrent deductions are the most dangerous bug surface
3. **Analytics calculations** — revenue/margin math is easy to get wrong silently
4. **Airtable formula building** — sanitization + filter composition

Use **Vitest** (already in the Vite ecosystem). Add a `backend/src/__tests__/` directory. No need for React component tests initially — the business logic is where bugs hide.

```json
// backend/package.json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

**Effort:** Medium (2–3 days for critical paths)
**Impact:** Very high — prevents silent regressions in the most dangerous code

---

## 5. VALIDATION LAYER — Inconsistent Input Checking

**Problem:** Input validation is ad-hoc across routes. `orders.js` checks required fields manually:

```js
if (!customer) return res.status(400).json({ error: 'Customer is required' });
if (!lines?.length) return res.status(400).json({ error: 'At least one line is required' });
```

Other routes have minimal or no validation. There's no shared validation pattern.

**What I'd do differently:**

Introduce a lightweight validation helper (no need for a full library like Joi/Zod for this scale):

```js
// backend/src/utils/validate.js
export function requireFields(body, fields) {
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      return `${f} is required`;
    }
  }
  return null;
}
```

Routes call `const err = requireFields(req.body, ['Customer', 'Lines']); if (err) return res.status(400).json({ error: err });`

Consistent pattern, zero dependencies, minimal code.

**Effort:** Low
**Impact:** Medium — prevents subtle bugs from missing fields

---

## 6. SSE RELIABILITY — No Catch-Up Mechanism

**Problem:** If a client disconnects (network switch, phone sleep) and reconnects, they miss all events that happened while offline. The current SSE implementation has no event history or sequence numbers.

**What I'd do differently:**

Add a small event buffer (last N events) with sequence IDs:

```js
// services/notifications.js
const EVENT_BUFFER_SIZE = 50;
const eventBuffer = [];
let eventSeq = 0;

export function broadcast(type, data) {
  const event = { id: ++eventSeq, type, data, ts: Date.now() };
  eventBuffer.push(event);
  if (eventBuffer.length > EVENT_BUFFER_SIZE) eventBuffer.shift();
  // ... send to clients
}

// On reconnect: client sends Last-Event-ID header
// Server replays missed events from buffer
```

This is built into the SSE spec (`Last-Event-ID` header). EventSource handles it automatically on reconnect — zero frontend changes needed.

**Effort:** Low (1–2 hours)
**Impact:** High — eliminates the "florist missed a new order" scenario

---

## 7. ERROR MONITORING — Flying Blind in Production

**Problem:** No error tracking service. Production errors go to Railway logs (stdout/stderr) which are hard to search and have no alerting.

**What I'd do differently:**

Add Sentry (free tier covers this scale). One file:

```js
// backend/src/config/sentry.js
import * as Sentry from '@sentry/node';
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN });
}
```

Add `Sentry.captureException(err)` in `errorHandler.js`. Done. You now get alerts, stack traces, and error grouping.

**Effort:** Very low (30 minutes)
**Impact:** High — you'll know when things break before users report it

---

## 8. FRONTEND DATA FETCHING — Manual useState/useEffect

**Problem:** Every page manually handles loading/error/data states:

```jsx
const [data, setData] = useState([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);

useEffect(() => {
  apiClient.get('/orders').then(res => setData(res.data)).catch(setError).finally(() => setLoading(false));
}, []);
```

This pattern is repeated in every page across all 3 apps. No caching, no deduplication, no background refetching.

**What I'd do differently:**

Introduce **TanStack Query** (React Query). It's the standard for this exact problem:

- Automatic caching + stale-while-revalidate
- Loading/error states handled by the library
- Background refetching when window regains focus
- SSE events can trigger `queryClient.invalidateQueries(['orders'])` — automatic cache invalidation

```jsx
const { data: orders, isLoading } = useQuery({
  queryKey: ['orders', { active: true }],
  queryFn: () => apiClient.get('/orders?activeOnly=true').then(r => r.data),
});
```

This eliminates ~50% of the boilerplate in page components and solves the "stale data after SSE notification" problem.

**Effort:** Medium (1–2 days to migrate incrementally)
**Impact:** High — less code, fewer bugs, better UX

---

## 9. BACKEND CONSTANTS & CONFIG — Settings Route as Shared State

**Problem:** `routes/settings.js` exports `getConfig()` and `getDriverOfDay()` which other routes import directly. This makes settings a **cross-cutting concern that lives in a route file**. Routes importing from other routes is an architectural smell.

**What I'd do differently:**

Move `getConfig()`, `getDriverOfDay()`, and `generateOrderId()` to a dedicated service:

```
backend/src/services/appConfig.js
```

Routes import from services, never from other routes. Clean dependency direction: `routes → services → db`.

**Effort:** Low (1 hour)
**Impact:** Medium — cleaner architecture, easier to test

---

## 10. CACHING FOR SETTINGS — Stale Config on Other Clients

**Problem:** When the owner changes settings (delivery zones, time slots, categories), other connected clients don't know until they refresh. Settings are fetched once on app mount.

**What I'd do differently:**

Broadcast a `settings_updated` SSE event when settings change. Frontend `useConfigLists` hook listens for this event and refetches. Combined with React Query (point 8), this becomes trivial:

```js
// Backend: settings route PATCH handler
broadcast('settings_updated', { updatedAt: Date.now() });

// Frontend: SSE handler
onEvent('settings_updated', () => queryClient.invalidateQueries(['settings']));
```

**Effort:** Very low if React Query is already adopted
**Impact:** Medium — prevents confusion from stale settings

---

## 11. AIRTABLE FORMULA BUILDER — Raw String Interpolation

**Problem:** Airtable filter formulas are built via string concatenation across every route:

```js
filters.push(`{Status} = '${sanitizeFormulaValue(status)}'`);
filters.push(`AND({Status} != 'Delivered', {Status} != 'Picked Up')`);
```

This is error-prone (missing quotes, AND/OR nesting mistakes) and hard to unit test.

**What I'd do differently:**

Create a small formula builder utility:

```js
// backend/src/utils/formula.js
export const eq = (field, value) => `{${field}} = '${sanitizeFormulaValue(value)}'`;
export const neq = (field, value) => `{${field}} != '${sanitizeFormulaValue(value)}'`;
export const and = (...clauses) => clauses.length === 1 ? clauses[0] : `AND(${clauses.join(', ')})`;
export const or = (...clauses) => clauses.length === 1 ? clauses[0] : `OR(${clauses.join(', ')})`;
export const dateRange = (field, from, to) => and(
  `NOT(IS_BEFORE({${field}}, '${sanitizeFormulaValue(from)}'))`,
  `NOT(IS_AFTER({${field}}, '${sanitizeFormulaValue(to)}'))`
);
```

Routes become readable and testable:

```js
const filter = and(eq('Status', status), dateRange('Order Date', from, to));
```

**Effort:** Low (2–3 hours)
**Impact:** Medium — prevents formula bugs, enables unit testing

---

## 12. FUTURE-READINESS CONSIDERATIONS

### If You Add More Users/Roles
- Current PIN system works for 5–8 people. Beyond that, consider JWT tokens with refresh — PINs in headers won't scale to 20+ users with individual permissions.

### If You Add a Second Blossom Location
- Airtable base is currently single-tenant. Would need either a "Location" field on every table or a second base. Plan for this in schema design now if expansion is on the horizon.

### If Airtable Becomes a Bottleneck
- The 5 req/sec limit is fine now but will become painful with 10+ concurrent users. At that point, consider:
  - A PostgreSQL cache layer that syncs from Airtable periodically
  - Or migrating entirely off Airtable to Supabase/PostgreSQL (preserving the same API surface)

### If You Need Offline Support (Drivers)
- Drivers in areas with poor connectivity can't use the app. A service worker + IndexedDB cache for the delivery list would solve this. PWA manifest is already in place.

---

## Priority Ranking

| # | Item | Effort | Impact | Do When |
|---|------|--------|--------|---------|
| 1 | Status constants | Low | High | Now |
| 2 | Error monitoring (Sentry) | Very low | High | Now |
| 3 | SSE catch-up buffer | Low | High | Now |
| 4 | Formula builder utility | Low | Medium | Now |
| 5 | Delete duplicate stockName copies | Very low | Medium | Now |
| 6 | Extract order creation service | Medium | High | Next sprint |
| 7 | Move settings exports to service | Low | Medium | Next sprint |
| 8 | Validation helper | Low | Medium | Next sprint |
| 9 | React Query adoption | Medium | High | Next sprint |
| 10 | Vitest test foundation | Medium | Very high | Soon |
| 11 | Settings SSE broadcast | Very low | Medium | After React Query |
| 12 | DatePicker to shared | Low | Low | When touching it |
