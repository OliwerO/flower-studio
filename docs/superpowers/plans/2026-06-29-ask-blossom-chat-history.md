# Ask Blossom — Chat History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every Ask Blossom conversation to Postgres so the owner can reopen, rename, and delete past chats from a history rail in the Assistant tab.

**Architecture:** A new `assistant_conversations` table stores the canonical Anthropic message array (jsonb) keyed by the existing `sessionId` (a uuid). `assistantService.ask()` rehydrates a missing session from PG (survives restart / cache miss) and upserts the conversation after every turn. Four new thin route endpoints (list / load / rename / delete) delegate to new service functions. The shared `AskBlossomPanel` grows a left history rail with "New chat", reopen, inline rename, and two-step delete. The in-memory `sessions` Map stays as a hot cache; PG is the source of truth.

**Tech Stack:** Postgres (custom SQL migration runner — drop a numbered `.sql` file), Drizzle ORM, Express, React 18 + Tailwind, Vitest + @testing-library/react (jsdom), pglite harness for repo/service integration tests.

## Global Constraints

- **Owner-only.** All endpoints already sit behind `router.use(authorize('assistant'))`. Do NOT add per-row owner scoping — single owner, no owner column.
- **Single source of truth for stored messages = the Anthropic message array** (`session.messages`). The DB row stores it verbatim; the UI never sees raw tool blocks — the service projects them to display turns via `toDisplayTurns`.
- **Persistence must never break a chat.** Wrap every PG write/read inside `ask()` in try/catch + `console.error('[ASSISTANT] ...', err)` — the user already has their answer; a save failure must not throw. (Root CLAUDE.md pitfall #5: log meaningfully, never silent-catch.)
- **Migrations:** add the next-numbered file to `backend/src/db/migrations/` (current max is `0015`). The custom runner (`backend/src/db/migrate.js`) and the pglite harness both read the dir lexicographically — NO Drizzle journal edit needed. Keep `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` (idempotent).
- **Status/role/string constants:** none new here, but never inline role strings — the route already uses `authorize('assistant')`.
- **`updatedAt` on UPDATE:** Drizzle `.defaultNow()` only fires on INSERT. On every UPDATE you MUST set `updatedAt: sql\`now()\`` explicitly, or the history list won't reorder.
- **Tests are mandatory** for the new repo (`backend/src/__tests__/`) and the new service functions. Mock `@anthropic-ai/sdk` and the conversation repo in the service unit test (vi.hoisted pattern, already used in `assistantService.test.js`); use the pgHarness `dbHolder` pattern for the repo integration test.

---

### Task 1: DB layer — migration, schema, repo

**Files:**
- Create: `backend/src/db/migrations/0016_assistant_conversations.sql`
- Modify: `backend/src/db/schema.js` (append a new `pgTable` near the other Phase tables; ensure `sql`, `index`, `desc` availability — `sql` and `index` are already imported)
- Create: `backend/src/repos/assistantConversationRepo.js`
- Test: `backend/src/__tests__/assistantConversationRepo.integration.test.js`

**Interfaces:**
- Consumes: `db` from `../db/index.js`; `assistantConversations` from `../db/schema.js`; `eq, desc, sql` from `drizzle-orm`.
- Produces (the repo's public API — Task 2 depends on these exact names/shapes):
  - `upsert({ id, title, messages }): Promise<void>` — insert or, on id conflict, update `messages` + `updatedAt` (title is NOT overwritten on conflict, so a rename survives later turns).
  - `list(): Promise<Array<{ id, title, updatedAt, messageCount }>>` — newest-first by `updatedAt`; `messageCount` = `jsonb_array_length(messages)` as a Number.
  - `getById(id): Promise<{ id, title, messages, createdAt, updatedAt } | null>`.
  - `rename(id, title): Promise<{ id, title } | null>` — null if no row matched.
  - `remove(id): Promise<boolean>` — true if a row was deleted.

- [ ] **Step 1: Write the migration SQL**

Create `backend/src/db/migrations/0016_assistant_conversations.sql`:

```sql
-- Ask Blossom chat history. id IS the assistant sessionId (uuid the service
-- generates). messages holds the canonical Anthropic message array verbatim;
-- the service projects it to display turns before it reaches the UI. Owner-only
-- feature (single owner) → no owner column. updated_at drives the history
-- list order and is bumped on every persisted turn.
CREATE TABLE IF NOT EXISTS assistant_conversations (
  id         uuid PRIMARY KEY,
  title      text NOT NULL DEFAULT '',
  messages   jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_conversations_updated_idx
  ON assistant_conversations (updated_at DESC);
```

- [ ] **Step 2: Add the Drizzle table to `schema.js`**

Append at the end of `backend/src/db/schema.js`. First confirm `desc` is NOT needed here (it's used in the repo, not the schema). The schema file already imports `pgTable, text, timestamp, jsonb, ... index` and `sql` — reuse them.

```js
// ── Ask Blossom: chat history ──
export const assistantConversations = pgTable('assistant_conversations', {
  id:        uuid('id').primaryKey(),
  title:     text('title').notNull().default(''),
  messages:  jsonb('messages').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  updatedIdx: index('assistant_conversations_updated_idx').on(t.updatedAt),
}));
```

- [ ] **Step 3: Write the repo**

Create `backend/src/repos/assistantConversationRepo.js`:

```js
// Data-access for assistant_conversations — Ask Blossom chat history.
// The row id IS the assistant sessionId. `messages` is the canonical Anthropic
// message array; projection to display turns happens in assistantService.
import { eq, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { assistantConversations } from '../db/schema.js';

// Insert a new conversation or, on id conflict, refresh its messages + bump
// updated_at. Title is written only on insert so a later rename is preserved.
export async function upsert({ id, title, messages }) {
  await db
    .insert(assistantConversations)
    .values({ id, title: title ?? '', messages })
    .onConflictDoUpdate({
      target: assistantConversations.id,
      set: { messages, updatedAt: sql`now()` },
    });
}

// Newest-first list for the history rail. messageCount lets the UI show size
// without shipping every message.
export async function list() {
  return db
    .select({
      id: assistantConversations.id,
      title: assistantConversations.title,
      updatedAt: assistantConversations.updatedAt,
      messageCount: sql`jsonb_array_length(${assistantConversations.messages})`.mapWith(Number),
    })
    .from(assistantConversations)
    .orderBy(desc(assistantConversations.updatedAt));
}

export async function getById(id) {
  const [row] = await db
    .select()
    .from(assistantConversations)
    .where(eq(assistantConversations.id, id));
  return row ?? null;
}

export async function rename(id, title) {
  const [row] = await db
    .update(assistantConversations)
    .set({ title, updatedAt: sql`now()` })
    .where(eq(assistantConversations.id, id))
    .returning({ id: assistantConversations.id, title: assistantConversations.title });
  return row ?? null;
}

export async function remove(id) {
  const rows = await db
    .delete(assistantConversations)
    .where(eq(assistantConversations.id, id))
    .returning({ id: assistantConversations.id });
  return rows.length > 0;
}
```

- [ ] **Step 4: Write the failing repo integration test**

Create `backend/src/__tests__/assistantConversationRepo.integration.test.js` (mirror `driverTelegramRepo.integration.test.js`'s dbHolder pattern):

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPgHarness, teardownPgHarness } from './helpers/pgHarness.js';
import crypto from 'node:crypto';

const dbHolder = { db: null };
vi.mock('../db/index.js', () => ({
  get db() { return dbHolder.db; },
  isPostgresConfigured: true,
  pool: null,
  connectPostgres: async () => {},
  disconnectPostgres: async () => {},
}));

import * as repo from '../repos/assistantConversationRepo.js';

let harness;
beforeEach(async () => { harness = await setupPgHarness(); dbHolder.db = harness.db; });
afterEach(async () => { await teardownPgHarness(harness); dbHolder.db = null; });

const msgs = (n) => Array.from({ length: n }, (_, i) => ({ role: 'user', content: `m${i}` }));

describe('assistantConversationRepo', () => {
  it('inserts then lists with messageCount, newest first', async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await repo.upsert({ id: a, title: 'first', messages: msgs(2) });
    await repo.upsert({ id: b, title: 'second', messages: msgs(4) });
    const rows = await repo.list();
    expect(rows.map(r => r.id)).toEqual([b, a]); // b updated last → first
    expect(rows.find(r => r.id === b).messageCount).toBe(4);
    expect(rows.find(r => r.id === a).title).toBe('first');
  });

  it('upsert on conflict refreshes messages but preserves title', async () => {
    const id = crypto.randomUUID();
    await repo.upsert({ id, title: 'orig', messages: msgs(1) });
    await repo.rename(id, 'renamed');
    await repo.upsert({ id, title: 'orig', messages: msgs(3) }); // a later turn
    const row = await repo.getById(id);
    expect(row.title).toBe('renamed'); // rename survived the upsert
    expect(row.messages).toHaveLength(3);
  });

  it('getById returns null for unknown id', async () => {
    expect(await repo.getById(crypto.randomUUID())).toBeNull();
  });

  it('rename returns the row, null when not found', async () => {
    const id = crypto.randomUUID();
    await repo.upsert({ id, title: 'x', messages: msgs(1) });
    expect(await repo.rename(id, 'newname')).toMatchObject({ id, title: 'newname' });
    expect(await repo.rename(crypto.randomUUID(), 'z')).toBeNull();
  });

  it('remove deletes and reports success/failure', async () => {
    const id = crypto.randomUUID();
    await repo.upsert({ id, title: 'x', messages: msgs(1) });
    expect(await repo.remove(id)).toBe(true);
    expect(await repo.getById(id)).toBeNull();
    expect(await repo.remove(id)).toBe(false);
  });
});
```

- [ ] **Step 5: Run the repo test — expect FAIL (table/repo not yet wired)**

Run: `cd backend && npx vitest run src/__tests__/assistantConversationRepo.integration.test.js`
Expected first run before the migration/schema/repo land: FAIL. After Steps 1-3 are in place: PASS (5 tests).

- [ ] **Step 6: Run it again to confirm PASS**

Run: `cd backend && npx vitest run src/__tests__/assistantConversationRepo.integration.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/migrations/0016_assistant_conversations.sql backend/src/db/schema.js backend/src/repos/assistantConversationRepo.js backend/src/__tests__/assistantConversationRepo.integration.test.js
git commit -m "feat(assistant): assistant_conversations table + repo (chat history)"
```

---

### Task 2: Service — persistence, rehydrate, projection, CRUD functions

**Files:**
- Modify: `backend/src/services/assistantService.js`
- Test: `backend/src/__tests__/assistantService.test.js` (extend)

**Interfaces:**
- Consumes: `* as conversationRepo` from `../repos/assistantConversationRepo.js` (Task 1's API).
- Produces (Task 3 routes depend on these):
  - `ask({ sessionId, message })` — unchanged signature; now rehydrates a missing session from PG and upserts after the turn.
  - `toDisplayTurns(messages): Array<{ role: 'user'|'assistant', text }>` — EXPORTED (used by getConversation + unit-tested directly).
  - `listConversations(): Promise<Array<{ id, title, updatedAt, messageCount }>>`.
  - `getConversation(id): Promise<{ id, title, messages: DisplayTurn[] } | null>`.
  - `renameConversation(id, title): Promise<{ id, title } | null>` — assumes title already validated non-empty by the route.
  - `deleteConversation(id): Promise<boolean>`.

- [ ] **Step 1: Write failing service tests (extend `assistantService.test.js`)**

The file already mocks `@anthropic-ai/sdk` and `../services/assistantTools/index.js` via `vi.hoisted`/`vi.mock`. Add a repo mock alongside them (place near the top, after the existing `vi.mock` calls):

```js
const { mockUpsert, mockGetById, mockList, mockRename, mockRemove } = vi.hoisted(() => ({
  mockUpsert: vi.fn(async () => {}),
  mockGetById: vi.fn(async () => null),
  mockList: vi.fn(async () => []),
  mockRename: vi.fn(async () => null),
  mockRemove: vi.fn(async () => false),
}));
vi.mock('../repos/assistantConversationRepo.js', () => ({
  upsert: mockUpsert, getById: mockGetById, list: mockList, rename: mockRename, remove: mockRemove,
}));
```

Update the import line to pull in the new exports:

```js
import { ask, toDisplayTurns, listConversations, getConversation, renameConversation, deleteConversation } from '../services/assistantService.js';
```

Add these tests inside the existing top-level `describe` (or a new `describe('assistant chat history', ...)`):

```js
describe('assistant chat history', () => {
  it('persists the conversation after a successful ask', async () => {
    mockCreate.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] });
    const r = await ask({ message: 'How many orders in May?' });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const arg = mockUpsert.mock.calls[0][0];
    expect(arg.id).toBe(r.sessionId);
    expect(arg.title).toBe('How many orders in May?'); // derived from first user message
    expect(Array.isArray(arg.messages)).toBe(true);
  });

  it('rehydrates a missing session from PG before answering', async () => {
    mockGetById.mockResolvedValueOnce({
      id: 'old-1', title: 't',
      messages: [{ role: 'user', content: 'earlier q' }, { role: 'assistant', content: [{ type: 'text', text: 'earlier a' }] }],
    });
    mockCreate.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'follow-up answer' }] });
    await ask({ sessionId: 'old-1', message: 'and June?' });
    expect(mockGetById).toHaveBeenCalledWith('old-1');
    const sentMessages = mockCreate.mock.calls[0][0].messages;
    expect(sentMessages[0]).toMatchObject({ role: 'user', content: 'earlier q' }); // prior turn restored
    expect(sentMessages.at(-1)).toMatchObject({ role: 'user', content: 'and June?' });
  });

  it('does not throw when persistence fails', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('db down'));
    mockCreate.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] });
    await expect(ask({ message: 'q' })).resolves.toMatchObject({ answer: 'ok' });
  });

  it('toDisplayTurns keeps user text + assistant text, drops tool turns', () => {
    const turns = toDisplayTurns([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'x', input: {} }] }, // pure tool_use → drop
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: '{}' }] },  // tool_result → drop
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
    ]);
    expect(turns).toEqual([{ role: 'user', text: 'q1' }, { role: 'assistant', text: 'answer' }]);
  });

  it('getConversation projects stored messages to display turns', async () => {
    mockGetById.mockResolvedValueOnce({ id: 'c1', title: 'T', messages: [{ role: 'user', content: 'hello' }] });
    expect(await getConversation('c1')).toEqual({ id: 'c1', title: 'T', messages: [{ role: 'user', text: 'hello' }] });
    mockGetById.mockResolvedValueOnce(null);
    expect(await getConversation('nope')).toBeNull();
  });

  it('list/rename/delete delegate to the repo', async () => {
    mockList.mockResolvedValueOnce([{ id: 'a', title: 't', updatedAt: 'x', messageCount: 2 }]);
    expect(await listConversations()).toHaveLength(1);
    mockRename.mockResolvedValueOnce({ id: 'a', title: 'new' });
    expect(await renameConversation('a', 'new')).toMatchObject({ title: 'new' });
    mockRemove.mockResolvedValueOnce(true);
    expect(await deleteConversation('a')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the new tests — expect FAIL (exports not defined)**

Run: `cd backend && npx vitest run src/__tests__/assistantService.test.js`
Expected: FAIL — `toDisplayTurns`/`listConversations`/etc. not exported; upsert not called.

- [ ] **Step 3: Implement the service changes**

Edit `backend/src/services/assistantService.js`:

1. Add the import near the top (after the TOOL imports):
```js
import * as conversationRepo from '../repos/assistantConversationRepo.js';
```

2. Add two helpers above `ask` (after `systemPrompt`):
```js
// First user message → conversation title, trimmed to 80 chars.
function deriveTitle(messages) {
  const firstUser = (messages || []).find(m => m.role === 'user' && typeof m.content === 'string');
  const raw = (firstUser?.content || '').trim();
  if (!raw) return '';
  return raw.length > 80 ? raw.slice(0, 80).trimEnd() + '…' : raw;
}

// Project the canonical Anthropic message array to UI display turns:
// keep user text + assistant text, drop tool_use / tool_result blocks.
export function toDisplayTurns(messages) {
  const turns = [];
  for (const m of messages || []) {
    if (m.role === 'user') {
      if (typeof m.content === 'string') turns.push({ role: 'user', text: m.content });
    } else if (m.role === 'assistant') {
      const text = typeof m.content === 'string'
        ? m.content
        : (Array.isArray(m.content) ? m.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim() : '');
      if (text) turns.push({ role: 'assistant', text });
    }
  }
  return turns;
}
```

3. Replace the session-resolution block at the start of `ask` (the current lines that do `let session = sessionId ? sessions.get(sessionId) : null; if (!session) { ... }`) with a version that rehydrates from PG on a cache miss:
```js
  let session = sessionId ? sessions.get(sessionId) : null;
  if (!session && sessionId) {
    // Reopened conversation after a restart / cache miss — rehydrate from PG.
    try {
      const row = await conversationRepo.getById(sessionId);
      if (row) { session = { messages: row.messages, createdAt: Date.now() }; sessions.set(sessionId, session); }
    } catch (err) {
      console.error('[ASSISTANT] failed to rehydrate conversation:', err);
    }
  }
  if (!session) {
    sessionId = crypto.randomUUID();
    session = { messages: [], createdAt: Date.now() };
    sessions.set(sessionId, session);
  }
```

4. Just before `return { sessionId, answer, toolResults };`, persist:
```js
  try {
    await conversationRepo.upsert({ id: sessionId, title: deriveTitle(session.messages), messages: session.messages });
  } catch (err) {
    console.error('[ASSISTANT] failed to persist conversation:', err);
  }
```

5. Add the CRUD service functions at the end of the file:
```js
export async function listConversations() {
  return conversationRepo.list();
}

export async function getConversation(id) {
  const row = await conversationRepo.getById(id);
  if (!row) return null;
  return { id: row.id, title: row.title, messages: toDisplayTurns(row.messages) };
}

// Title is validated non-empty by the route; returns null when no row matched.
export async function renameConversation(id, title) {
  return conversationRepo.rename(id, title);
}

export async function deleteConversation(id) {
  return conversationRepo.remove(id);
}
```

- [ ] **Step 4: Run the service tests — expect PASS**

Run: `cd backend && npx vitest run src/__tests__/assistantService.test.js`
Expected: PASS (existing tests + 6 new ones).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/assistantService.js backend/src/__tests__/assistantService.test.js
git commit -m "feat(assistant): persist + rehydrate conversations, expose history CRUD in service"
```

---

### Task 3: Routes — list / load / rename / delete

**Files:**
- Modify: `backend/src/routes/assistant.js`
- Test: `backend/src/__tests__/assistant.route.test.js` (extend)

**Interfaces:**
- Consumes: `listConversations, getConversation, renameConversation, deleteConversation` from `../services/assistantService.js` (Task 2).
- Produces: HTTP endpoints under `/api/assistant`:
  - `GET /conversations` → 200 `[{id,title,updatedAt,messageCount}]`
  - `GET /conversations/:id` → 200 `{id,title,messages}` | 404
  - `PATCH /conversations/:id` body `{title}` → 200 `{id,title}` | 400 (empty title) | 404
  - `DELETE /conversations/:id` → 204 | 404
  - All inherit the existing `authorize('assistant')` (owner-only → 403 otherwise).

- [ ] **Step 1: Write failing route tests (extend `assistant.route.test.js`)**

Update the `vi.mock('../services/assistantService.js', ...)` factory to also export the new functions, and import them:

```js
vi.mock('../services/assistantService.js', () => ({
  ask: vi.fn(async ({ message }) => ({ sessionId: 's1', answer: `echo:${message}`, toolResults: [] })),
  listConversations: vi.fn(async () => [{ id: 'c1', title: 'T', updatedAt: '2026-06-29', messageCount: 2 }]),
  getConversation: vi.fn(async (id) => (id === 'c1' ? { id: 'c1', title: 'T', messages: [{ role: 'user', text: 'q' }] } : null)),
  renameConversation: vi.fn(async (id, title) => (id === 'c1' ? { id: 'c1', title } : null)),
  deleteConversation: vi.fn(async (id) => id === 'c1'),
}));

import assistantRouter from '../routes/assistant.js';
import { ask, listConversations, getConversation, renameConversation, deleteConversation } from '../services/assistantService.js';
```

Add a new describe block:

```js
describe('Ask Blossom conversation history routes', () => {
  it('GET /conversations lists for the owner', async () => {
    const res = await request(appWithRole('owner')).get('/api/assistant/conversations');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 'c1', messageCount: 2 });
  });

  it('GET /conversations is owner-only (403 florist)', async () => {
    const res = await request(appWithRole('florist')).get('/api/assistant/conversations');
    expect(res.status).toBe(403);
    expect(listConversations).not.toHaveBeenCalled();
  });

  it('GET /conversations/:id returns 200 then 404', async () => {
    expect((await request(appWithRole('owner')).get('/api/assistant/conversations/c1')).status).toBe(200);
    expect((await request(appWithRole('owner')).get('/api/assistant/conversations/nope')).status).toBe(404);
  });

  it('PATCH /conversations/:id renames; 400 empty; 404 missing', async () => {
    const ok = await request(appWithRole('owner')).patch('/api/assistant/conversations/c1').send({ title: 'New name' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: 'c1', title: 'New name' });
    expect((await request(appWithRole('owner')).patch('/api/assistant/conversations/c1').send({ title: '  ' })).status).toBe(400);
    expect((await request(appWithRole('owner')).patch('/api/assistant/conversations/nope').send({ title: 'x' })).status).toBe(404);
  });

  it('DELETE /conversations/:id returns 204 then 404', async () => {
    expect((await request(appWithRole('owner')).delete('/api/assistant/conversations/c1')).status).toBe(204);
    expect((await request(appWithRole('owner')).delete('/api/assistant/conversations/nope')).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run route tests — expect FAIL**

Run: `cd backend && npx vitest run src/__tests__/assistant.route.test.js`
Expected: FAIL — new routes return 404 (not defined).

- [ ] **Step 3: Implement the routes**

Edit `backend/src/routes/assistant.js`. Update the import:
```js
import { ask, listConversations, getConversation, renameConversation, deleteConversation } from '../services/assistantService.js';
```

Add after the existing `POST /message` handler (before `export default router;`):
```js
router.get('/conversations', async (req, res, next) => {
  try {
    res.json(await listConversations());
  } catch (err) { next(err); }
});

router.get('/conversations/:id', async (req, res, next) => {
  try {
    const c = await getConversation(req.params.id);
    if (!c) return res.status(404).json({ error: 'conversation not found' });
    res.json(c);
  } catch (err) { next(err); }
});

router.patch('/conversations/:id', async (req, res, next) => {
  try {
    const title = (req.body?.title ?? '').trim();
    if (!title) return res.status(400).json({ error: 'title (non-empty string) is required' });
    const row = await renameConversation(req.params.id, title.slice(0, 200));
    if (!row) return res.status(404).json({ error: 'conversation not found' });
    res.json(row);
  } catch (err) { next(err); }
});

router.delete('/conversations/:id', async (req, res, next) => {
  try {
    const ok = await deleteConversation(req.params.id);
    if (!ok) return res.status(404).json({ error: 'conversation not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: Run route tests — expect PASS**

Run: `cd backend && npx vitest run src/__tests__/assistant.route.test.js`
Expected: PASS (existing 3 + 5 new).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/assistant.js backend/src/__tests__/assistant.route.test.js
git commit -m "feat(assistant): conversation history endpoints (list/load/rename/delete)"
```

---

### Task 4: UI — history rail in AskBlossomPanel + translations

**Files:**
- Modify: `packages/shared/components/AskBlossomPanel.jsx`
- Modify: `apps/dashboard/src/translations.js` (add keys to BOTH the `en` and `ru` blocks)
- Test: `packages/shared/test/AskBlossomPanel.test.jsx` (extend)

**Interfaces:**
- Consumes: `client` (axios) `.get/.post/.patch/.delete`; `t` translation object with NEW keys: `assistantNewChat, assistantNoHistory, assistantUntitled, assistantRename, assistantDelete, assistantDeleteConfirm, assistantHistory`.
- Produces: a two-column panel — left history rail (New chat + list with reopen/rename/delete), right chat (unchanged behaviour). No new exports.

**Note on the existing chat column:** keep the existing message-render block (the `prose ... ReactMarkdown remarkPlugins={[remarkGfm]}` markup landed in commit 7a407e6) verbatim — only wrap it in the new layout. Do NOT regress the markdown-table rendering.

- [ ] **Step 1: Add translation keys**

In `apps/dashboard/src/translations.js`, locate the existing `assistant*` keys (e.g. `assistantPlaceholder`) in the `en` object and add alongside them:
```js
    assistantHistory: 'Chats',
    assistantNewChat: '+ New chat',
    assistantNoHistory: 'No saved chats yet',
    assistantUntitled: 'Untitled',
    assistantRename: 'Rename',
    assistantDelete: 'Delete',
    assistantDeleteConfirm: 'Delete?',
```
And in the `ru` object alongside the Russian `assistant*` keys:
```js
    assistantHistory: 'Чаты',
    assistantNewChat: '+ Новый чат',
    assistantNoHistory: 'Пока нет сохранённых чатов',
    assistantUntitled: 'Без названия',
    assistantRename: 'Переименовать',
    assistantDelete: 'Удалить',
    assistantDeleteConfirm: 'Удалить?',
```
(If the file has a single object rather than en/ru blocks, follow the file's actual shape — match how the existing `assistantPlaceholder` key is defined.)

- [ ] **Step 2: Write the failing UI tests (extend `AskBlossomPanel.test.jsx`)**

The current client mock is `{ default: { post: vi.fn() } }`. Replace it to include `get/patch/delete`, and give `get` a default in `beforeEach`:

```js
vi.mock('../api/client.js', () => ({ default: { post: vi.fn(), get: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
import client from '../api/client.js';
```

Extend the `t` fixture with the new keys:
```js
const t = { assistantPlaceholder: 'Спросите…', assistantSend: 'Спросить', assistantThinking: 'Думаю…', assistantError: 'Ошибка', assistantEmpty: 'Задайте вопрос о ваших данных', assistantHistory: 'Чаты', assistantNewChat: '+ Новый чат', assistantNoHistory: 'Нет чатов', assistantUntitled: 'Без названия', assistantRename: 'Переименовать', assistantDelete: 'Удалить', assistantDeleteConfirm: 'Удалить?' };
```

In `beforeEach`, after `vi.clearAllMocks()`, add a default for the mount fetch:
```js
beforeEach(() => { vi.clearAllMocks(); client.get.mockResolvedValue({ data: [] }); });
```

Add these tests:
```js
it('lists saved conversations on mount', async () => {
  client.get.mockResolvedValueOnce({ data: [{ id: 'c1', title: 'May orders', updatedAt: 'x', messageCount: 2 }] });
  render(<AskBlossomPanel t={t} />);
  expect(await screen.findByText('May orders')).toBeInTheDocument();
});

it('reopens a conversation when its row is clicked', async () => {
  client.get
    .mockResolvedValueOnce({ data: [{ id: 'c1', title: 'May orders', updatedAt: 'x', messageCount: 2 }] }) // mount list
    .mockResolvedValueOnce({ data: { id: 'c1', title: 'May orders', messages: [{ role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1' }] } }); // load
  render(<AskBlossomPanel t={t} />);
  fireEvent.click(await screen.findByText('May orders'));
  expect(await screen.findByText('q1')).toBeInTheDocument();
  expect(await screen.findByText('a1')).toBeInTheDocument();
  expect(client.get).toHaveBeenLastCalledWith('/assistant/conversations/c1');
});

it('New chat clears the current conversation', async () => {
  client.post.mockResolvedValueOnce({ data: { sessionId: 's1', answer: 'a', toolResults: [] } });
  render(<AskBlossomPanel t={t} />);
  fireEvent.change(screen.getByPlaceholderText('Спросите…'), { target: { value: 'q' } });
  fireEvent.click(screen.getByText('Спросить'));
  await screen.findByText('a');
  fireEvent.click(screen.getByText('+ Новый чат'));
  expect(screen.queryByText('a')).not.toBeInTheDocument();
});

it('refreshes the history list after sending', async () => {
  client.post.mockResolvedValueOnce({ data: { sessionId: 's1', answer: 'a', toolResults: [] } });
  render(<AskBlossomPanel t={t} />);
  await waitFor(() => expect(client.get).toHaveBeenCalledTimes(1)); // mount
  fireEvent.change(screen.getByPlaceholderText('Спросите…'), { target: { value: 'q' } });
  fireEvent.click(screen.getByText('Спросить'));
  await screen.findByText('a');
  await waitFor(() => expect(client.get).toHaveBeenCalledTimes(2)); // refreshed after send
});

it('deletes a conversation via two-step confirm', async () => {
  client.get.mockResolvedValueOnce({ data: [{ id: 'c1', title: 'May orders', updatedAt: 'x', messageCount: 2 }] });
  client.delete.mockResolvedValueOnce({ status: 204 });
  render(<AskBlossomPanel t={t} />);
  await screen.findByText('May orders');
  fireEvent.click(screen.getByLabelText('Удалить')); // trash → arms confirm
  fireEvent.click(screen.getByText('Удалить?'));      // confirm
  await waitFor(() => expect(client.delete).toHaveBeenCalledWith('/assistant/conversations/c1'));
});
```

- [ ] **Step 3: Run UI tests — expect FAIL**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/AskBlossomPanel.test.jsx`
Expected: FAIL — no history rail / New chat button yet.

- [ ] **Step 4: Rewrite `AskBlossomPanel.jsx` with the history rail**

Replace the full contents of `packages/shared/components/AskBlossomPanel.jsx` with:

```jsx
import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import client from '../api/client.js';

export default function AskBlossomPanel({ t }) {
  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant', text }
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: 'smooth' }); }, [messages, loading]);
  useEffect(() => { refreshList(); }, []);

  async function refreshList() {
    try {
      const { data } = await client.get('/assistant/conversations');
      setConversations(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[AskBlossom] failed to load history:', err);
    }
  }

  function newChat() {
    setMessages([]);
    setSessionId(null);
    setInput('');
    setConfirmDeleteId(null);
    setEditingId(null);
  }

  async function loadConversation(id) {
    try {
      const { data } = await client.get(`/assistant/conversations/${id}`);
      setMessages(data.messages || []);
      setSessionId(data.id);
      setConfirmDeleteId(null);
      setEditingId(null);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: err.response?.data?.error || t.assistantError }]);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setLoading(true);
    try {
      const { data } = await client.post('/assistant/message', { sessionId, message: text });
      setSessionId(data.sessionId);
      setMessages((m) => [...m, { role: 'assistant', text: data.answer }]);
      refreshList();
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: err.response?.data?.error || t.assistantError }]);
    } finally {
      setLoading(false);
    }
  }

  function startRename(c) {
    setEditingId(c.id);
    setEditTitle(c.title || '');
  }

  async function saveRename(id) {
    const title = editTitle.trim();
    setEditingId(null);
    if (!title) return;
    try {
      await client.patch(`/assistant/conversations/${id}`, { title });
      refreshList();
    } catch (err) {
      console.error('[AskBlossom] rename failed:', err);
    }
  }

  async function doDelete(id) {
    setConfirmDeleteId(null);
    try {
      await client.delete(`/assistant/conversations/${id}`);
      if (id === sessionId) newChat();
      refreshList();
    } catch (err) {
      console.error('[AskBlossom] delete failed:', err);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="flex h-full max-h-[70vh] gap-3">
      <aside className="w-48 shrink-0 border-r flex flex-col">
        <button
          className="m-2 bg-brand-600 text-white rounded-lg px-3 py-2 text-sm"
          onClick={newChat}
        >
          {t.assistantNewChat}
        </button>
        <div className="flex-1 overflow-y-auto px-1 pb-2 space-y-1">
          {conversations.length === 0 && <p className="text-secondary text-xs text-center mt-4">{t.assistantNoHistory}</p>}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group rounded-lg px-2 py-1.5 text-sm cursor-pointer flex items-center gap-1 ${c.id === sessionId ? 'bg-brand-100' : 'hover:bg-gray-100'}`}
            >
              {editingId === c.id ? (
                <input
                  className="flex-1 border rounded px-1 py-0.5 text-sm min-w-0"
                  value={editTitle}
                  autoFocus
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => saveRename(c.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveRename(c.id); if (e.key === 'Escape') setEditingId(null); }}
                />
              ) : (
                <button className="flex-1 text-left truncate min-w-0" onClick={() => loadConversation(c.id)}>
                  {c.title || t.assistantUntitled}
                </button>
              )}
              {editingId !== c.id && confirmDeleteId !== c.id && (
                <span className="hidden group-hover:flex items-center gap-1 shrink-0">
                  <button aria-label={t.assistantRename} className="text-secondary text-xs px-0.5" onClick={() => startRename(c)}>✎</button>
                  <button aria-label={t.assistantDelete} className="text-secondary text-xs px-0.5" onClick={() => setConfirmDeleteId(c.id)}>✕</button>
                </span>
              )}
              {confirmDeleteId === c.id && (
                <button className="text-red-600 text-xs shrink-0" onClick={() => doDelete(c.id)}>{t.assistantDeleteConfirm}</button>
              )}
            </div>
          ))}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto space-y-3 p-2">
          {messages.length === 0 && <p className="text-secondary text-center mt-8">{t.assistantEmpty}</p>}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
              <div className={`inline-block rounded-lg px-3 py-2 max-w-[85%] ${m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
                {m.role === 'assistant'
                  ? <div className="prose prose-sm max-w-none prose-table:my-2 prose-th:px-2 prose-td:px-2"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown></div>
                  : m.text}
              </div>
            </div>
          ))}
          {loading && <div className="text-left"><div className="inline-block rounded-lg px-3 py-2 bg-gray-100 text-gray-500">{t.assistantThinking}</div></div>}
          <div ref={endRef} />
        </div>
        <div className="flex gap-2 p-2 border-t">
          <input
            className="flex-1 border rounded-lg px-3 py-2"
            placeholder={t.assistantPlaceholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={loading}
          />
          <button className="bg-brand-600 text-white rounded-lg px-4 py-2 disabled:opacity-50" onClick={send} disabled={loading}>
            {t.assistantSend}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run UI tests — expect PASS**

Run: `cd packages/shared && ../../backend/node_modules/.bin/vitest run test/AskBlossomPanel.test.jsx`
Expected: PASS (existing 4 + 5 new).

- [ ] **Step 6: Build all three apps (shared component change reaches every app)**

Run each and confirm OK:
```bash
cd apps/florist && ./node_modules/.bin/vite build
cd ../dashboard && ./node_modules/.bin/vite build
cd ../delivery && ./node_modules/.bin/vite build
```
Expected: all succeed (no missing deps — uses only react-markdown + remark-gfm already in shared).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/components/AskBlossomPanel.jsx apps/dashboard/src/translations.js packages/shared/test/AskBlossomPanel.test.jsx
git commit -m "feat(assistant): chat history rail — reopen, rename, delete, new chat"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** Auto-save = Task 2 upsert-after-every-turn. Reopen = Task 2 `getConversation` + Task 3 GET + Task 4 `loadConversation`. Rename = Task 1 `rename` repo + Task 2/3 + Task 4 inline edit. Delete = full stack + two-step confirm. New chat = Task 4. ✓
- **Type consistency:** `toDisplayTurns` returns `{role,text}` everywhere (service projection, UI state, tests). Repo `list` shape `{id,title,updatedAt,messageCount}` matches the route mock and the UI row. `upsert({id,title,messages})` signature consistent across repo/service/tests. ✓
- **Placeholder scan:** no TBD/ "add error handling" — every catch logs with context or shows a bubble. ✓
- **Risk note for reviewers:** the existing `assistantService.test.js` calls `ask()` with no sessionId, so the rehydrate branch is skipped there; the upsert at the end will now invoke the (mocked) repo — the new repo mock prevents a real DB hit. Confirm the repo mock is added BEFORE the `import { ask }` line.
