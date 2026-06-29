# Ask Blossom — Floating Chat Launcher

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Replace the top Assistant tab (dashboard) and the More-menu entry (florist) with a single shared floating chat button. Phone → bottom sheet; desktop → right side drawer. Owner-only.

**Architecture:** One shared `AskBlossomLauncher` (FAB + responsive overlay hosting `AskBlossomPanel`). Mounted at each app's root. Responsive presentation via Tailwind `sm:` variants (bottom-sheet by default, right-drawer at `sm` and up) — no JS breakpoint. Removes the old dashboard tab + florist route/page so `AskBlossomPanel` is consumed only through the launcher.

**Tech Stack:** React 18 + Tailwind, `@flower-studio/shared`, Vitest + @testing-library/react.

## Global Constraints

- **Owner-only.** Dashboard is already an owner-only app (mount unconditionally there). Florist app serves florists too — gate the florist mount on `role === 'owner'`.
- **No new shared dependency.** Use an inline SVG for the sparkle icon — do NOT import lucide-react into the shared package (breaks Vercel isolation builds).
- **No new translation keys.** Reuse `t.tabAssistant` (exists in both apps) for the FAB aria-label + drawer title; "Ask Blossom" header text is a literal brand name.
- **FAB must clear the florist bottom nav.** The launcher takes a `fabClassName` prop; florist passes an offset that sits above its `h-16` BottomNav.
- **Build all three apps** before the wiring task is done (shared change reaches every app; Vercel builds in isolation).

---

### Task 1: Shared `AskBlossomLauncher` component

**Files:**
- Create: `packages/shared/components/AskBlossomLauncher.jsx`
- Modify: `packages/shared/components/AskBlossomPanel.jsx` (root: `max-h-[70vh]` → fill container)
- Modify: `packages/shared/index.js` (export the launcher)
- Test: `packages/shared/test/AskBlossomLauncher.test.jsx`

**Interfaces:**
- Produces: `AskBlossomLauncher({ t, fabClassName })` — default export from the component, re-exported named from `index.js`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/AskBlossomLauncher.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AskBlossomLauncher from '../components/AskBlossomLauncher.jsx';

vi.mock('../api/client.js', () => ({ default: { post: vi.fn(), get: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
import client from '../api/client.js';

const t = { tabAssistant: 'Assistant', assistantPlaceholder: 'Ask…', assistantSend: 'Ask', assistantThinking: '…', assistantError: 'err', assistantEmpty: 'empty', assistantHistory: 'Chats', assistantNewChat: '+ New', assistantNoHistory: 'none', assistantUntitled: 'Untitled', assistantRename: 'Rename', assistantDelete: 'Delete', assistantDeleteConfirm: 'Delete?' };

beforeEach(() => { vi.clearAllMocks(); client.get.mockResolvedValue({ data: [] }); });

describe('AskBlossomLauncher', () => {
  it('shows a FAB and no panel initially', () => {
    render(<AskBlossomLauncher t={t} />);
    expect(screen.getByLabelText('Assistant')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Ask…')).not.toBeInTheDocument();
  });

  it('opens the panel on FAB click and closes on ✕', async () => {
    render(<AskBlossomLauncher t={t} />);
    fireEvent.click(screen.getByLabelText('Assistant'));
    expect(await screen.findByPlaceholderText('Ask…')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close'));
    await waitFor(() => expect(screen.queryByPlaceholderText('Ask…')).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`cd packages/shared && ../../backend/node_modules/.bin/vitest run test/AskBlossomLauncher.test.jsx`) — module not found.

- [ ] **Step 3: Create `AskBlossomLauncher.jsx`**

```jsx
import { useState } from 'react';
import AskBlossomPanel from './AskBlossomPanel.jsx';

// Floating chat launcher for the owner. A bottom-right FAB opens the assistant:
// a bottom sheet on phones, a right-side drawer on desktop (responsive via `sm:`).
// Shared by the dashboard + florist apps; replaces the old top tab / nav entry.
// `fabClassName` lets a host nudge the button (e.g. above the florist bottom nav).
const SPARKLE = "M12 2l1.8 4.9L19 8.7l-4.2 2.6L13.5 16 12 11.6 10.5 16 9.2 11.3 5 8.7l5.2-1.8L12 2z";

export default function AskBlossomLauncher({ t, fabClassName = 'bottom-6 right-6' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <style>{`
        @keyframes alb-up{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes alb-right{from{transform:translateX(100%)}to{transform:translateX(0)}}
        @keyframes alb-fade{from{opacity:0}to{opacity:1}}
      `}</style>

      {!open && (
        <button
          aria-label={t.tabAssistant}
          onClick={() => setOpen(true)}
          className={`fixed z-40 ${fabClassName} w-14 h-14 rounded-full bg-brand-600 text-white shadow-xl flex items-center justify-center hover:bg-brand-700 active:scale-95 transition`}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={SPARKLE} /></svg>
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 animate-[alb-fade_0.18s_ease-out]" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label={t.tabAssistant}
            className="fixed z-50 bg-white shadow-2xl flex flex-col overflow-hidden
                       inset-x-0 bottom-0 top-[12%] rounded-t-2xl animate-[alb-up_0.22s_ease-out]
                       sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[440px] sm:max-w-[92vw] sm:rounded-none sm:animate-[alb-right_0.22s_ease-out]"
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-brand-600 text-white shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={SPARKLE} /></svg>
              <span className="font-semibold text-sm flex-1">Ask Blossom</span>
              <button aria-label="Close" onClick={() => setOpen(false)} className="w-7 h-7 rounded hover:bg-white/20 leading-none text-lg">✕</button>
            </div>
            <div className="flex-1 min-h-0">
              <AskBlossomPanel t={t} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 4: Make `AskBlossomPanel` fill its container**

In `packages/shared/components/AskBlossomPanel.jsx`, change the root element's className from `flex h-full max-h-[70vh] gap-3` to `flex h-full gap-3` (the launcher now controls height; the old `max-h-[70vh]` left dead space in a full-height drawer). This is the ONLY change to that file.

- [ ] **Step 5: Export from `index.js`**

Add beside the existing `AskBlossomPanel` export (`packages/shared/index.js:151`):
```js
export { default as AskBlossomLauncher } from './components/AskBlossomLauncher.jsx';
```

- [ ] **Step 6: Run the test — expect PASS** (`cd packages/shared && ../../backend/node_modules/.bin/vitest run test/AskBlossomLauncher.test.jsx`).

- [ ] **Step 7: Run the existing panel test too** (`../../backend/node_modules/.bin/vitest run test/AskBlossomPanel.test.jsx`) — must stay green (the root-class change doesn't alter behavior).

- [ ] **Step 8: Commit**
```bash
git add packages/shared/components/AskBlossomLauncher.jsx packages/shared/components/AskBlossomPanel.jsx packages/shared/index.js packages/shared/test/AskBlossomLauncher.test.jsx
git commit -m "feat(assistant): shared AskBlossomLauncher (FAB + responsive drawer/sheet)"
```

---

### Task 2: Wire launcher into both apps; remove old surfaces; docs

**Files:**
- Modify: `apps/dashboard/src/pages/DashboardPage.jsx`
- Delete: `apps/dashboard/src/components/AssistantTab.jsx`
- Modify: `apps/florist/src/App.jsx`
- Modify: `apps/florist/src/components/BottomNav.jsx`
- Delete: `apps/florist/src/pages/AssistantPage.jsx`
- Modify: `apps/dashboard/CLAUDE.md`, `apps/florist/CLAUDE.md`, `CHANGELOG.md`

**Interfaces:** Consumes `AskBlossomLauncher` from `@flower-studio/shared` (Task 1).

- [ ] **Step 1: Dashboard — remove the Assistant tab, mount the launcher**

In `apps/dashboard/src/pages/DashboardPage.jsx`:
1. Delete the lazy import line: `const AssistantTab = lazy(() => import('../components/AssistantTab.jsx'));`
2. Remove the TABS entry `{ key: 'assistant', label: t.tabAssistant },`.
3. Remove the render block:
```jsx
        {renderMountedTab('assistant',
          <AssistantTab isActive={activeTab === 'assistant'} />
        )}
```
4. Add to the shared import (the file already imports `{ FeedbackModal } from '@flower-studio/shared'`): change it to `import { FeedbackModal, AskBlossomLauncher } from '@flower-studio/shared';`
5. Mount the launcher just before the final closing `</div>` of the component's return (after the `{reportOpen && (...)}` FeedbackModal block):
```jsx
      <AskBlossomLauncher t={t} />
```

- [ ] **Step 2: Delete the dashboard AssistantTab**

`git rm apps/dashboard/src/components/AssistantTab.jsx` (no longer referenced).

- [ ] **Step 3: Florist — remove route + nav entry, mount launcher owner-only**

In `apps/florist/src/App.jsx`:
1. Remove the lazy import `const AssistantPage = lazy(() => import('./pages/AssistantPage.jsx'));` and the `/assistant` `<Route>` block.
2. Add the import: `import { AskBlossomLauncher } from '@flower-studio/shared';` and `import t from './translations.js';` (if `t` isn't already imported there — check; BottomNav imports it, App may not).
3. Make `Layout` render the launcher for the owner. `Layout` currently wraps `{children}` + `<BottomNav/>`. Change it to read auth and mount the launcher above the nav:
```jsx
function Layout({ children }) {
  const { role } = useAuth();
  return (
    <>
      {children}
      <BottomNav />
      {role === 'owner' && <AskBlossomLauncher t={t} fabClassName="bottom-20 right-4" />}
    </>
  );
}
```
(`useAuth` is already imported at the top of App.jsx.)

In `apps/florist/src/components/BottomNav.jsx`:
4. Remove the `Sparkles` entry from `ownerOnlyItems` (the `{ Icon: Sparkles, label: t.tabAssistant, action: () => navigate('/assistant') },` line) and remove `Sparkles` from the lucide-react import (leave the other icons).

- [ ] **Step 4: Delete the florist AssistantPage**

`git rm apps/florist/src/pages/AssistantPage.jsx`.

- [ ] **Step 5: Update docs**

- `apps/dashboard/CLAUDE.md`: remove the `Assistant | AssistantTab.jsx | ...` row from the Tabs table; add a one-line note (e.g. under Key Components or a short line) that the owner reaches Ask Blossom via the shared floating `AskBlossomLauncher` (FAB), mounted in DashboardPage.
- `apps/florist/CLAUDE.md`: remove the `AssistantPage | /assistant | owner | ...` row; note the shared `AskBlossomLauncher` FAB (owner-only, mounted in App `Layout`, offset above BottomNav).
- `CHANGELOG.md`: prepend a `## 2026-06-29 — Ask Blossom: floating chat button` entry (moved from tab/menu into an owner-only FAB → bottom sheet on phone, right drawer on desktop). ALSO add a short `## 2026-06-29 — Analytics: flower revenue now net (reconciles)` entry backfilling PR #445 (flowerRevenue = total − delivery; total = flowers + delivery; Flower Margin now realized). Put the newest first.

- [ ] **Step 6: Build all three apps**
```bash
cd apps/dashboard && ./node_modules/.bin/vite build
cd ../florist && ./node_modules/.bin/vite build
cd ../delivery && ./node_modules/.bin/vite build
```
All must succeed (no dangling AssistantTab/AssistantPage imports; launcher resolves; `animate-[...]` arbitrary utilities compile).

- [ ] **Step 7: Commit**
```bash
git add apps/dashboard/src/pages/DashboardPage.jsx apps/florist/src/App.jsx apps/florist/src/components/BottomNav.jsx apps/dashboard/CLAUDE.md apps/florist/CLAUDE.md CHANGELOG.md
git commit -m "feat(assistant): mount floating launcher in dashboard + florist; remove tab/menu surfaces"
```
(The two `git rm` deletions from Steps 2 & 4 are already staged by `git rm`; include them in this commit — verify with `git status` that AssistantTab.jsx + AssistantPage.jsx show as deleted.)

---

## Self-Review (plan author)
- **Phone = bottom sheet, Desktop = drawer:** one element, `inset-x-0 bottom-0 top-[12%]` (mobile) overridden by `sm:inset-y-0 sm:right-0 sm:w-[440px]` (desktop). ✓
- **Owner-only:** dashboard mount unconditional (owner app); florist mount gated `role === 'owner'`. ✓
- **No lucide in shared / no new dep:** inline SVG sparkle; FAB aria-label + title reuse `t.tabAssistant`. ✓
- **Old surfaces removed:** dashboard tab + AssistantTab.jsx deleted; florist route + AssistantPage.jsx + Sparkles nav entry removed. AskBlossomPanel now consumed only via launcher, so the `max-h-[70vh]`→`h-full` change has no other consumer. ✓
- **FAB clears florist nav:** `fabClassName="bottom-20 right-4"`. ✓
- **Risk:** `animate-[alb-up_...]` references keyframes injected via a runtime `<style>` (global), not tailwind.config — emits a plain `animation:` rule, resolves at runtime. If a reviewer worries, the fallback is the panel still renders correctly without the animation (positioning classes are independent of the keyframes).
