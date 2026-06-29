# Ask Blossom — Slice 1 Dev Summary
**Date:** 2026-06-29  
**Branch:** feat/ask-blossom-assistant  
**PRs in slice:** Tasks 1–6 (one cohesive feature branch)

---

## What changed

### Dashboard mount (Task 6 — this task)
- **`apps/dashboard/src/components/AssistantTab.jsx`** (new): thin wrapper that mounts the shared `AskBlossomPanel` when the tab is active. Imports via the barrel (`@flower-studio/shared`). Passes `t` from `apps/dashboard/src/translations.js`.
- **`apps/dashboard/src/pages/DashboardPage.jsx`**: lazy import + `{ key: 'assistant', label: t.tabAssistant }` TABS entry (after `financial`) + `renderMountedTab('assistant', ...)` call in `<main>`.
- **`apps/dashboard/src/translations.js`**: 6 new keys added to both `en` and `ru` locale blocks — `tabAssistant`, `assistantPlaceholder`, `assistantSend`, `assistantThinking`, `assistantError`, `assistantEmpty`.
- **`apps/dashboard/tailwind.config.js`**: `@tailwindcss/typography` added to `plugins` array so the `prose prose-sm` classes used by `AskBlossomPanel` render properly in the dashboard.
- **`apps/dashboard/package.json`**: `@tailwindcss/typography ^0.5.20` added as devDependency.

### Shared panel (Task 5 — earlier in branch)
- **`packages/shared/components/AskBlossomPanel.jsx`** (new): chat UI with session continuity (`sessionId`), markdown rendering via `react-markdown`, `POST /api/assistant/message` calls via `client.js`. Accepts `t` prop for i18n; renders empty prompt, user bubbles, assistant bubbles, loading indicator.
- **`packages/shared/index.js`**: barrel re-exports `AskBlossomPanel`.

### Backend (Tasks 1–4 — earlier in branch)
- **`backend/src/routes/assistant.js`**: `POST /api/assistant/message`, owner-only. Accepts `{ sessionId?, message }`, calls `assistantService.chat()`, returns `{ sessionId, answer }`.
- **`backend/src/services/assistantService.js`**: Anthropic Claude integration with in-memory multi-turn session history. Each session is a UUID; history is cleared if the server restarts (acceptable for v1).
- **`backend/src/services/assistantTools/`**: tool-pack directory — thin adapters over canonical services. `financial_summary` calls `computeAnalytics()` from `analyticsService.js` (same function the `/api/analytics` route calls, so numbers are always identical). `order_search` goes via `orderRepo`.

---

## Why

The owner needs to interrogate business data conversationally — "how many orders in May?", "which channel brought the most revenue last quarter?" — without exporting to a spreadsheet. The thin-adapter architecture ensures the assistant's answers match what the dashboard tabs show: both draw from the same repos and service functions.

---

## How it connects

```
DashboardPage.jsx
  └─ AssistantTab.jsx       (new, lazy-loaded)
       └─ AskBlossomPanel   (packages/shared/components/)
            └─ POST /api/assistant/message
                 └─ assistantService.chat()
                      ├─ tool: financial_summary  → analyticsService.computeAnalytics()
                      └─ tool: order_search       → orderRepo
```

The `AssistantTab` simply gates on `isActive` and sets a fixed height container (`h-[75vh]`). All chat state lives inside `AskBlossomPanel` — no lifting to the dashboard page, no cross-tab coupling.

The `@tailwindcss/typography` plugin was added to the dashboard's tailwind config (not the florist's) because the florist app does not yet mount `AskBlossomPanel`. When the florist mount is added (follow-up), its tailwind config will need the same plugin.

---

## What to watch for

1. **Session memory is in-process, not in DB.** If Railway restarts the backend (e.g. on deploy), all active sessions are lost. The user just starts a fresh conversation — no data loss, just context. Tracked as a follow-up (persistent session history).

2. **`ANTHROPIC_API_KEY` must be set in Railway env.** Without it, every assistant message returns a 500. Confirm it is set before announcing the feature to the owner.

3. **Typography plugin only in the dashboard.** The `prose` CSS classes from `react-markdown` will render as unstyled text in the florist app until `@tailwindcss/typography` is added to `apps/florist/tailwind.config.js` there too. This is acceptable for v1 (florist mount is deferred).

4. **Owner-only at the API layer.** The tab itself renders for any logged-in dashboard user, but only the Owner PIN (`PIN_OWNER`) gets a 200 from `POST /api/assistant/message`. A florist or driver PIN gets a 403. The dashboard itself is always behind the owner PIN, so this is belt-and-suspenders but correct.

5. **Tool pack is minimal — orders + financials.** Stock queries, customer insights, and PO data are follow-up tool packs. Each is a small independent `assistantTools/<domain>Pack.js` addition registered in the service.

6. **Build gate passed for all three apps.** Dashboard (1.64 s), florist (1.30 s), delivery (0.66 s) — all green.

7. **Test results:** backend 628 tests pass (71 files), shared 538 tests pass (48 files), E2E 220 assertions pass (28 sections).

---

## Files changed (this task — Task 6)

| File | Change |
|------|--------|
| `apps/dashboard/src/components/AssistantTab.jsx` | Created |
| `apps/dashboard/src/pages/DashboardPage.jsx` | Lazy import + TABS entry + renderMountedTab |
| `apps/dashboard/src/translations.js` | 6 keys × 2 locales (en + ru) |
| `apps/dashboard/tailwind.config.js` | Added `@tailwindcss/typography` plugin |
| `apps/dashboard/package.json` | Added `@tailwindcss/typography` devDep |
| `CLAUDE.md` | Key Files section: assistant route + service + tools |
| `backend/CLAUDE.md` | Routes table: assistant.js; Services table: assistantService.js |
| `apps/dashboard/CLAUDE.md` | Tabs table: Assistant tab |
| `docs/superpowers/reports/2026-06-29-ask-blossom-slice1-dev-summary.md` | This file |

---

## HUMAN-VERIFY smoke test (cannot be run by agent — needs live ANTHROPIC_API_KEY + Owner PIN)

1. `npm run backend` (needs `ANTHROPIC_API_KEY` in `backend/.env`; optional `ASSISTANT_MODEL`)
2. `npm run dashboard`
3. Open dashboard in browser, log in with the **Owner PIN**
4. Click the **Помощник** (or "Assistant") tab
5. Ask: `сколько заказов в мае?` — expect a real number, not an error
6. Follow up: `как они делятся на доставку и самовывоз?` — expect the same session to retain context
7. In a separate incognito window, log in with the **Florist PIN** and confirm the tab either does not appear or the backend returns a 403 (the tab renders but the API rejects non-owner tokens)
8. Confirm: markdown (bullet lists, bold) in assistant replies renders styled, not raw asterisks
