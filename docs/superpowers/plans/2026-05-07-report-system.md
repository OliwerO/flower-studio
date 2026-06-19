# Report System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-app Report button (all three apps) and Telegram bot that lets Owner/Florists/Drivers submit bugs and feature requests in Russian, guided by AI clarifying questions, then creates a structured English GitHub issue.

**Architecture:** A `feedbackService.js` holds all business logic (AI conversation, session state, GitHub REST, DB write). Four thin routes (`/feedback/*`) expose it over HTTP. A shared `FeedbackModal` component drives the conversation UI across all three apps. A separate `feedbackTelegramBot.js` routes Telegram messages through the same service.

**Tech Stack:** Node.js `fetch` for GitHub REST API, `@anthropic-ai/sdk` for Claude Haiku (same pattern as `intake-parser.js`), Drizzle ORM for `feedback_reports` table, multer for screenshot upload, React + Tailwind for `FeedbackModal`.

---

## File Map

**Create:**
- `backend/src/db/migrations/0008_feedback_reports.sql`
- `backend/src/services/feedbackService.js`
- `backend/src/routes/feedback.js`
- `backend/src/__tests__/feedbackService.test.js`
- `backend/src/services/feedbackTelegramBot.js`
- `packages/shared/components/FeedbackModal.jsx`

**Modify:**
- `backend/src/db/schema.js` — add `feedbackReports` table
- `backend/src/index.js` — register feedback route
- `.env.example` — add `GITHUB_TOKEN`, `FEEDBACK_BOT_TOKEN`
- `apps/florist/src/components/BottomNav.jsx` — Report item in More menu
- `apps/florist/src/translations.js` — add report keys
- `apps/dashboard/src/pages/DashboardPage.jsx` — Report button in header
- `apps/dashboard/src/translations.js` — add report keys
- `apps/delivery/src/pages/DeliveryListPage.jsx` — Report button in header
- `apps/delivery/src/translations.js` — add report keys
- `packages/shared/index.js` — export `FeedbackModal`
- `backend/src/routes/webhook.js` — add GitHub issues close handler

---

## Phase 1 — Bare Pipeline (implements #236)

### Task 1: DB migration + schema + GitHub issue creation

**Files:**
- Create: `backend/src/db/migrations/0008_feedback_reports.sql`
- Modify: `backend/src/db/schema.js`
- Create: `backend/src/services/feedbackService.js`
- Modify: `.env.example`

- [ ] **Step 1: Create the migration SQL**

Create `backend/src/db/migrations/0008_feedback_reports.sql`:

```sql
CREATE TABLE IF NOT EXISTS feedback_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_issue_number INTEGER NOT NULL,
  reporter_role       TEXT NOT NULL,
  reporter_name       TEXT NOT NULL,
  telegram_chat_id    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Add Drizzle table definition to schema.js**

In `backend/src/db/schema.js`, after the last existing `export const`:

```js
export const feedbackReports = pgTable('feedback_reports', {
  id:                uuid('id').primaryKey().defaultRandom(),
  githubIssueNumber: integer('github_issue_number').notNull(),
  reporterRole:      text('reporter_role').notNull(),
  reporterName:      text('reporter_name').notNull(),
  telegramChatId:    text('telegram_chat_id'),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

You'll also need to add `integer` to the drizzle-pg imports at the top of `schema.js`. Find the line that imports from `drizzle-orm/pg-core` and add `integer` to it.

- [ ] **Step 3: Create feedbackService.js (bare — no AI yet)**

Create `backend/src/services/feedbackService.js`:

```js
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/index.js';
import { feedbackReports } from '../db/schema.js';

const GITHUB_OWNER = 'OliwerO';
const GITHUB_REPO  = 'flower-studio';
const MODEL = 'claude-haiku-4-5-20251001';

// In-memory session store. Sessions expire after 30 minutes.
// { [sessionId]: { reporterRole, reporterName, appArea, messages, createdAt, done, ... } }
const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}, 5 * 60 * 1000);

function newSessionId() {
  return crypto.randomUUID();
}

/**
 * Start a new Report session. Stores reporter metadata and initial text.
 * In Phase 1 (no AI), marks done immediately so publish can be called right away.
 * Returns { sessionId, done: true }.
 */
export async function startSession({ text, appArea, reporterRole, reporterName }) {
  const sessionId = newSessionId();
  sessions.set(sessionId, {
    reporterRole,
    reporterName,
    appArea: appArea || null,
    messages: [{ role: 'user', content: text }],
    createdAt: Date.now(),
    done: true,
    title: text.slice(0, 80),
    englishDescription: text,
    acceptanceCriteria: [],
    russianSummary: text,
    originalQuote: text,
    type: 'bug',
  });
  return { sessionId, done: true };
}

/**
 * Create the GitHub issue and write the feedback_reports row.
 * Returns { issueUrl, issueNumber }.
 */
export async function publishSession(sessionId, imageBuffer = null, imageFilename = null) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found or expired');
  if (!session.done) throw new Error('Session not complete — preview first');

  const issueBody = buildIssueBody(session, imageBuffer, imageFilename);

  const issueNumber = await githubCreateIssue(session.title, issueBody);
  const issueUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}`;

  await db.insert(feedbackReports).values({
    githubIssueNumber: issueNumber,
    reporterRole:      session.reporterRole,
    reporterName:      session.reporterName,
    telegramChatId:    session.telegramChatId || null,
  });

  sessions.delete(sessionId);
  return { issueUrl, issueNumber };
}

function buildIssueBody(session, imageBuffer, imageFilename) {
  const acs = session.acceptanceCriteria.length > 0
    ? session.acceptanceCriteria.map(c => `- [ ] ${c}`).join('\n')
    : '- [ ] (To be defined during implementation)';

  const imageSection = imageBuffer
    ? `\n## Screenshot\n\n_(image upload pending — will be attached)_\n`
    : '';

  return `## What to build

${session.englishDescription}
${imageSection}
## Acceptance criteria

${acs}

## Blocked by

None

---
_Reported by ${session.reporterName} (${session.reporterRole})${session.appArea ? ` via ${session.appArea}` : ''}_
_Original text: "${session.originalQuote}"_`;
}

async function githubCreateIssue(title, body) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');

  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ title, body, labels: ['needs-triage'] }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.number;
}

// Exported for tests
export { sessions };
```

- [ ] **Step 4: Add GITHUB_TOKEN to .env.example**

In `.env.example`, after the `ANTHROPIC_API_KEY` line add:

```
# GitHub fine-grained PAT — Issues write + Contents write on OliwerO/flower-studio
# Create at github.com/settings/personal-access-tokens/new
GITHUB_TOKEN=github_pat_xxxxx

# Feedback Telegram bot — separate from the notification bot
# Get token from @BotFather on Telegram
FEEDBACK_BOT_TOKEN=
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/0008_feedback_reports.sql \
        backend/src/db/schema.js \
        backend/src/services/feedbackService.js \
        .env.example
git commit -m "feat(feedback): DB migration, schema, bare feedbackService with GitHub issue creation"
```

---

### Task 2: /feedback routes + register in index.js

**Files:**
- Create: `backend/src/routes/feedback.js`
- Modify: `backend/src/index.js`

- [ ] **Step 1: Create the routes file**

Create `backend/src/routes/feedback.js`:

```js
import { Router } from 'express';
import multer from 'multer';
import { authorize } from '../middleware/auth.js';
import * as feedbackService from '../services/feedbackService.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    ok ? cb(null, true) : cb(new Error('JPG, PNG, or WebP only'));
  },
});

// All feedback routes require any authenticated role
router.use(authorize('owner', 'florist', 'driver'));

// POST /feedback/start — begin a Report session
router.post('/start', async (req, res) => {
  try {
    const { text, appArea, reporterRole, reporterName } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    if (!reporterRole) return res.status(400).json({ error: 'reporterRole is required' });
    if (!reporterName) return res.status(400).json({ error: 'reporterName is required' });

    const result = await feedbackService.startSession({ text, appArea, reporterRole, reporterName });
    res.json(result);
  } catch (err) {
    console.error('[FEEDBACK] start error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /feedback/continue — send next message in conversation
router.post('/continue', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

    const result = await feedbackService.continueSession(sessionId, message);
    res.json(result);
  } catch (err) {
    console.error('[FEEDBACK] continue error:', err);
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// POST /feedback/preview — get Russian summary before publishing
router.post('/preview', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const result = await feedbackService.previewSession(sessionId);
    res.json(result);
  } catch (err) {
    console.error('[FEEDBACK] preview error:', err);
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// POST /feedback/publish — create GitHub issue (multipart to support optional screenshot)
router.post('/publish', upload.single('image'), async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const imageBuffer = req.file ? req.file.buffer : null;
    const imageName   = req.file ? req.file.originalname : null;
    const result = await feedbackService.publishSession(sessionId, imageBuffer, imageName);
    res.json(result);
  } catch (err) {
    console.error('[FEEDBACK] publish error:', err);
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

export default router;
```

- [ ] **Step 2: Register the route in index.js**

In `backend/src/index.js`, find the existing route imports block (around line 12–33) and add:

```js
import feedbackRoutes from './routes/feedback.js';
```

Then in the route registration block (after the auth middleware), add:

```js
app.use('/api/feedback', feedbackRoutes);
```

- [ ] **Step 3: Start test harness to verify routes are reachable**

```bash
npm run harness &
sleep 3
curl -s -X POST http://localhost:3001/api/feedback/start \
  -H "Content-Type: application/json" \
  -H "X-Auth-PIN: 1234" \
  -d '{"text":"Test report","reporterRole":"owner","reporterName":"Owner"}' | jq .
```

Expected: `{ "sessionId": "<uuid>", "done": true }`

Kill the harness after verifying: `pkill -f start-test-backend`

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/feedback.js backend/src/index.js
git commit -m "feat(feedback): POST /feedback/* routes with multer screenshot support"
```

---

### Task 3: feedbackService unit tests

**Files:**
- Create: `backend/src/__tests__/feedbackService.test.js`

- [ ] **Step 1: Write the tests**

Create `backend/src/__tests__/feedbackService.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock DB — must be before importing the service
vi.mock('../db/index.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));
vi.mock('../db/schema.js', () => ({ feedbackReports: {} }));

// Mock fetch for GitHub API
global.fetch = vi.fn();

// Set required env
process.env.GITHUB_TOKEN = 'test-token';

import { startSession, publishSession, sessions } from '../services/feedbackService.js';

beforeEach(() => {
  sessions.clear();
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ number: 42, html_url: 'https://github.com/OliwerO/flower-studio/issues/42' }),
    text: async () => '',
  });
});

describe('startSession', () => {
  it('creates a session and returns sessionId + done:true', async () => {
    const result = await startSession({
      text: 'Кнопка не работает',
      reporterRole: 'florist',
      reporterName: 'Анна',
    });

    expect(result.sessionId).toBeDefined();
    expect(result.done).toBe(true);
    expect(sessions.has(result.sessionId)).toBe(true);
  });

  it('stores appArea when provided', async () => {
    const { sessionId } = await startSession({
      text: 'Проблема',
      reporterRole: 'owner',
      reporterName: 'Owner',
      appArea: 'dashboard',
    });
    expect(sessions.get(sessionId).appArea).toBe('dashboard');
  });
});

describe('publishSession', () => {
  it('creates a GitHub issue and inserts a DB row', async () => {
    const { sessionId } = await startSession({
      text: 'Не отображается кнопка',
      reporterRole: 'florist',
      reporterName: 'Анна',
    });

    const result = await publishSession(sessionId);

    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/repos/OliwerO/flower-studio/issues');
    expect(JSON.parse(opts.body)).toMatchObject({
      labels: ['needs-triage'],
      title: expect.any(String),
    });

    expect(result.issueUrl).toContain('github.com');
    expect(result.issueNumber).toBe(42);
  });

  it('throws if sessionId is not found', async () => {
    await expect(publishSession('nonexistent')).rejects.toThrow('Session not found');
  });

  it('deletes session after successful publish', async () => {
    const { sessionId } = await startSession({
      text: 'Test',
      reporterRole: 'driver',
      reporterName: 'Timur',
    });
    await publishSession(sessionId);
    expect(sessions.has(sessionId)).toBe(false);
  });

  it('throws if GITHUB_TOKEN is missing', async () => {
    const token = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    const { sessionId } = await startSession({ text: 'x', reporterRole: 'owner', reporterName: 'Owner' });
    await expect(publishSession(sessionId)).rejects.toThrow('GITHUB_TOKEN');
    process.env.GITHUB_TOKEN = token;
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd backend && npx vitest run src/__tests__/feedbackService.test.js
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/src/__tests__/feedbackService.test.js
git commit -m "test(feedback): feedbackService unit tests — GitHub issue creation and session lifecycle"
```

---

## Phase 2 — AI Enrichment + Multi-turn (implements #237 + #238)

### Task 4: AI classification, translation, and issue formatting

**Files:**
- Modify: `backend/src/services/feedbackService.js`

- [ ] **Step 1: Update startSession to call the AI**

Replace the `startSession` function in `feedbackService.js` with this version (keep all other code as-is):

```js
const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You are a feedback assistant for Blossom, a flower studio app used in Krakow, Poland.
Your job: gather enough information from the reporter to create a high-quality GitHub issue.

Domain glossary (use exact terms in issue bodies — never use the "Avoid" alternatives):
- Report: bug or feature request (not: ticket, feedback item)
- Order: customer request for bouquets (not: purchase, transaction)
- Delivery: physical delivery to address (not: shipment, dispatch)
- Stock Item / Batch / Demand Entry: inventory tracking units
- Stock Order: procurement order (not: PO, Purchase Order)
- Write-off: waste/damage stock reduction (not: stock loss)
- Florist app: tablet/phone app for florists and owner on mobile
- Dashboard: desktop owner control panel
- Delivery app: phone app for drivers
- Florist: studio employee who builds bouquets (not: staff, employee)
- Driver: delivery/shopping person (not: courier)
- Owner: business owner with full access (not: admin)

For BUG reports, you need: which screen, what action was taken, what actually happened, what should have happened.
For FEATURE REQUESTS, you need: what problem needs solving, what success looks like.

Ask ONE clarifying question at a time in plain Russian. Keep questions short with concrete examples.
When you have enough information, respond with done:true and all fields.

ALWAYS respond with valid JSON only — no markdown fences, no extra text:

If more info needed:
{"done": false, "question": "Russian question string"}

When complete:
{"done": true, "type": "bug", "englishTitle": "Short English title under 70 chars", "englishDescription": "Clear English description of the problem and context", "acceptanceCriteria": ["English criterion 1", "English criterion 2"], "originalQuote": "reporter's exact words", "russianSummary": "Plain Russian summary of what will be submitted — 2-3 sentences"}`;

export async function startSession({ text, appArea, reporterRole, reporterName }) {
  const sessionId = newSessionId();
  const messages = [{ role: 'user', content: text }];

  const aiResult = await callAI(messages);

  sessions.set(sessionId, {
    reporterRole,
    reporterName,
    appArea: appArea || null,
    messages,
    createdAt: Date.now(),
    ...(aiResult.done
      ? { done: true, ...aiResult }
      : { done: false }),
  });

  if (aiResult.done) return { sessionId, done: true };
  return { sessionId, done: false, question: aiResult.question };
}
```

- [ ] **Step 2: Add callAI helper**

Add this function to `feedbackService.js` after the `newSessionId` function:

```js
async function callAI(messages) {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  });

  const text = res.content[0]?.text || '{}';
  try {
    return JSON.parse(text);
  } catch {
    // If AI returns malformed JSON, treat as not done and ask to rephrase
    return { done: false, question: 'Извините, что-то пошло не так. Пожалуйста, опишите проблему ещё раз.' };
  }
}
```

- [ ] **Step 3: Update tests to mock Anthropic**

In `feedbackService.test.js`, add at the top of the `vi.mock` block:

```js
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ text: JSON.stringify({
          done: true,
          type: 'bug',
          englishTitle: 'Button does not work on order screen',
          englishDescription: 'The save button on the Order edit screen does nothing when tapped.',
          acceptanceCriteria: ['Tapping Save on the Order edit screen saves changes'],
          originalQuote: 'кнопка не работает',
          russianSummary: 'Кнопка сохранения на экране редактирования заказа не работает.',
        }) }],
      }),
    };
  },
}));
```

- [ ] **Step 4: Run tests**

```bash
cd backend && npx vitest run src/__tests__/feedbackService.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/feedbackService.js backend/src/__tests__/feedbackService.test.js
git commit -m "feat(feedback): AI classification and English issue formatting via Claude Haiku"
```

---

### Task 5: Multi-turn session management

**Files:**
- Modify: `backend/src/services/feedbackService.js`
- Modify: `backend/src/__tests__/feedbackService.test.js`

- [ ] **Step 1: Add continueSession to feedbackService.js**

Add this function after `startSession`:

```js
/**
 * Process the reporter's reply in an ongoing conversation.
 * Appends their message, calls AI, updates session state.
 * Returns { done: false, question } or { done: true } when AI has enough info.
 */
export async function continueSession(sessionId, message) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found or expired');
  if (session.done) return { done: true };

  session.messages.push({ role: 'assistant', content: session.lastQuestion || '' });
  session.messages.push({ role: 'user', content: message });

  const aiResult = await callAI(session.messages);

  if (aiResult.done) {
    Object.assign(session, { done: true, ...aiResult });
    return { done: true };
  }

  session.lastQuestion = aiResult.question;
  return { done: false, question: aiResult.question };
}
```

Also update `startSession` to store the question on the session when not done:

```js
  if (aiResult.done) return { sessionId, done: true };
  session.lastQuestion = aiResult.question;   // ← add this line
  return { sessionId, done: false, question: aiResult.question };
```

- [ ] **Step 2: Add continueSession tests**

In `feedbackService.test.js`, add after the `publishSession` describe block:

```js
describe('continueSession', () => {
  it('returns next question when AI is not done', async () => {
    // Override AI to return not-done on first call
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    Anthropic.prototype.messages = {
      create: vi.fn()
        .mockResolvedValueOnce({
          content: [{ text: JSON.stringify({ done: false, question: 'На каком экране это произошло?' }) }],
        })
        .mockResolvedValueOnce({
          content: [{ text: JSON.stringify({
            done: true,
            type: 'bug',
            englishTitle: 'Save button broken on order screen',
            englishDescription: 'Tapping save does nothing.',
            acceptanceCriteria: ['Save button saves changes'],
            originalQuote: 'кнопка не работает',
            russianSummary: 'Кнопка сохранения не работает на экране заказов.',
          }) }],
        }),
    };

    const { sessionId, done, question } = await startSession({
      text: 'кнопка не работает',
      reporterRole: 'florist',
      reporterName: 'Анна',
    });
    expect(done).toBe(false);
    expect(question).toBe('На каком экране это произошло?');

    const result = await continueSession(sessionId, 'На экране заказов');
    expect(result.done).toBe(true);
    expect(sessions.get(sessionId).done).toBe(true);
  });

  it('throws on unknown sessionId', async () => {
    await expect(continueSession('bad-id', 'text')).rejects.toThrow('not found');
  });
});
```

Add `continueSession` to the import line at the top of the test file.

- [ ] **Step 3: Run tests**

```bash
cd backend && npx vitest run src/__tests__/feedbackService.test.js
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/feedbackService.js backend/src/__tests__/feedbackService.test.js
git commit -m "feat(feedback): multi-turn conversation — continueSession + in-memory TTL sessions"
```

---

## Phase 3 — Preview + Confirmation (implements #239)

### Task 6: Preview endpoint

**Files:**
- Modify: `backend/src/services/feedbackService.js`
- Modify: `backend/src/__tests__/feedbackService.test.js`

- [ ] **Step 1: Add previewSession to feedbackService.js**

Add after `continueSession`:

```js
/**
 * Return a plain Russian summary of what will be submitted.
 * The reporter reads this and decides to confirm or correct.
 */
export async function previewSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found or expired');
  if (!session.done) throw new Error('Session not complete yet — continue the conversation');
  return { summary: session.russianSummary };
}
```

- [ ] **Step 2: Add previewSession test**

In `feedbackService.test.js`, add:

```js
describe('previewSession', () => {
  it('returns russianSummary from a completed session', async () => {
    const { sessionId } = await startSession({
      text: 'кнопка не работает',
      reporterRole: 'florist',
      reporterName: 'Анна',
    });
    const { summary } = await previewSession(sessionId);
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
  });

  it('throws when session is not done', async () => {
    // Force AI to return not-done
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    Anthropic.prototype.messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ text: JSON.stringify({ done: false, question: 'Какой экран?' }) }],
      }),
    };
    const { sessionId } = await startSession({ text: 'x', reporterRole: 'owner', reporterName: 'Owner' });
    await expect(previewSession(sessionId)).rejects.toThrow('not complete');
  });
});
```

Add `previewSession` to the import line.

- [ ] **Step 3: Run tests**

```bash
cd backend && npx vitest run src/__tests__/feedbackService.test.js
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/feedbackService.js backend/src/__tests__/feedbackService.test.js
git commit -m "feat(feedback): previewSession — Russian summary before GitHub issue is published"
```

---

## Phase 4 — In-app UI: Florist App (implements #240)

### Task 7: FeedbackModal shared component + translation keys

**Files:**
- Create: `packages/shared/components/FeedbackModal.jsx`
- Modify: `packages/shared/index.js`
- Modify: `apps/florist/src/translations.js`
- Modify: `apps/dashboard/src/translations.js`
- Modify: `apps/delivery/src/translations.js`

- [ ] **Step 1: Add translation keys to all three apps**

In `apps/florist/src/translations.js`, find the English block (starts around line 1) and add after the existing keys:

```js
  reportButton:          'Report',
  reportTitle:           'Report a Problem',
  reportPlaceholder:     'Describe the problem or request...',
  reportSend:            'Send',
  reportConfirm:         'Looks right — submit',
  reportCorrect:         'Correct it',
  reportSuccess:         'Report submitted! Thank you.',
  reportError:           'Failed to submit report. Please try again.',
  reportPreviewTitle:    'Check your report',
  reportAddScreenshot:   'Add screenshot',
  reportThinking:        'Thinking...',
```

Find the Russian block (starts around line 710) and add after the existing keys:

```js
  reportButton:          'Сообщить о проблеме',
  reportTitle:           'Отправить отчёт',
  reportPlaceholder:     'Опишите проблему или пожелание...',
  reportSend:            'Отправить',
  reportConfirm:         'Всё верно — отправить',
  reportCorrect:         'Исправить',
  reportSuccess:         'Отчёт отправлен! Спасибо.',
  reportError:           'Не удалось отправить отчёт. Попробуйте ещё раз.',
  reportPreviewTitle:    'Проверьте ваш отчёт',
  reportAddScreenshot:   'Добавить скриншот',
  reportThinking:        'Думаю...',
```

Repeat the same additions in `apps/dashboard/src/translations.js` (same keys, same positions in EN and RU blocks).

Repeat in `apps/delivery/src/translations.js`.

- [ ] **Step 2: Create FeedbackModal.jsx**

Create `packages/shared/components/FeedbackModal.jsx`:

```jsx
import { useState, useRef } from 'react';
import { X, MessageSquareWarning, Loader2, CheckCircle, ImagePlus } from 'lucide-react';

/*
 * FeedbackModal — drives the full AI-assisted Report conversation.
 *
 * Props:
 *   t            — translations object from the calling app
 *   apiClient    — the app's axios client (with auth PIN pre-attached)
 *   reporterRole — 'owner' | 'florist' | 'driver'
 *   reporterName — display name of the logged-in user
 *   appArea      — string identifying which app ('florist' | 'dashboard' | 'delivery')
 *   onClose      — called when modal should be dismissed
 */
export default function FeedbackModal({ t, apiClient, reporterRole, reporterName, appArea, onClose }) {
  const [phase, setPhase] = useState('input'); // input | asking | preview | done | error
  const [text, setText]   = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer]     = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [summary, setSummary]   = useState('');
  const [issueUrl, setIssueUrl] = useState('');
  const [loading, setLoading]   = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const fileRef = useRef();

  async function handleStart() {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const { data } = await apiClient.post('/feedback/start', {
        text: text.trim(),
        appArea,
        reporterRole,
        reporterName,
      });
      setSessionId(data.sessionId);
      if (data.done) {
        await loadPreview(data.sessionId);
      } else {
        setQuestion(data.question);
        setPhase('asking');
      }
    } catch (err) {
      console.error('[FeedbackModal] start error', err);
      setPhase('error');
    } finally {
      setLoading(false);
    }
  }

  async function handleContinue() {
    if (!answer.trim()) return;
    setLoading(true);
    try {
      const { data } = await apiClient.post('/feedback/continue', {
        sessionId,
        message: answer.trim(),
      });
      setAnswer('');
      if (data.done) {
        await loadPreview(sessionId);
      } else {
        setQuestion(data.question);
      }
    } catch (err) {
      console.error('[FeedbackModal] continue error', err);
      setPhase('error');
    } finally {
      setLoading(false);
    }
  }

  async function loadPreview(sid) {
    try {
      const { data } = await apiClient.post('/feedback/preview', { sessionId: sid });
      setSummary(data.summary);
      setPhase('preview');
    } catch (err) {
      console.error('[FeedbackModal] preview error', err);
      setPhase('error');
    }
  }

  async function handlePublish() {
    setLoading(true);
    try {
      const form = new FormData();
      form.append('sessionId', sessionId);
      if (imageFile) form.append('image', imageFile, imageFile.name);

      const { data } = await apiClient.post('/feedback/publish', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setIssueUrl(data.issueUrl);
      setPhase('done');
    } catch (err) {
      console.error('[FeedbackModal] publish error', err);
      setPhase('error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-xl p-5 mx-2 mb-0 sm:mb-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MessageSquareWarning size={20} className="text-brand-600" />
            <h2 className="font-semibold text-ios-label dark:text-dark-label">{t.reportTitle}</h2>
          </div>
          <button onClick={onClose} className="text-ios-tertiary hover:text-ios-label p-1">
            <X size={20} />
          </button>
        </div>

        {/* Phase: input */}
        {phase === 'input' && (
          <div className="space-y-3">
            <textarea
              className="w-full rounded-xl border border-gray-200 dark:border-gray-600 p-3 text-sm
                         bg-white dark:bg-gray-700 text-ios-label dark:text-dark-label
                         focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
              rows={4}
              placeholder={t.reportPlaceholder}
              value={text}
              onChange={e => setText(e.target.value)}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 text-xs text-ios-secondary dark:text-gray-400
                           border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2"
              >
                <ImagePlus size={14} />
                {imageFile ? imageFile.name.slice(0, 20) : t.reportAddScreenshot}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => setImageFile(e.target.files[0] || null)} />
            </div>
            <button
              onClick={handleStart}
              disabled={loading || !text.trim()}
              className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white
                         font-medium rounded-xl py-3 text-sm flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {loading ? t.reportThinking : t.reportSend}
            </button>
          </div>
        )}

        {/* Phase: asking (follow-up question) */}
        {phase === 'asking' && (
          <div className="space-y-3">
            <p className="text-sm text-ios-label dark:text-dark-label bg-gray-50 dark:bg-gray-700
                          rounded-xl p-3">{question}</p>
            <textarea
              className="w-full rounded-xl border border-gray-200 dark:border-gray-600 p-3 text-sm
                         bg-white dark:bg-gray-700 text-ios-label dark:text-dark-label
                         focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
              rows={3}
              placeholder={t.reportPlaceholder}
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              autoFocus
            />
            <button
              onClick={handleContinue}
              disabled={loading || !answer.trim()}
              className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white
                         font-medium rounded-xl py-3 text-sm flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {loading ? t.reportThinking : t.reportSend}
            </button>
          </div>
        )}

        {/* Phase: preview */}
        {phase === 'preview' && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-ios-secondary dark:text-gray-400 uppercase tracking-wide">
              {t.reportPreviewTitle}
            </p>
            <p className="text-sm text-ios-label dark:text-dark-label bg-gray-50 dark:bg-gray-700
                          rounded-xl p-3">{summary}</p>
            <div className="flex gap-2">
              <button
                onClick={() => { setPhase('asking'); setQuestion(''); setAnswer(''); }}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-ios-label
                           dark:text-dark-label font-medium rounded-xl py-3 text-sm"
              >
                {t.reportCorrect}
              </button>
              <button
                onClick={handlePublish}
                disabled={loading}
                className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white
                           font-medium rounded-xl py-3 text-sm flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                {loading ? t.reportThinking : t.reportConfirm}
              </button>
            </div>
          </div>
        )}

        {/* Phase: done */}
        {phase === 'done' && (
          <div className="space-y-3 text-center py-2">
            <CheckCircle size={40} className="text-green-500 mx-auto" />
            <p className="text-sm font-medium text-ios-label dark:text-dark-label">{t.reportSuccess}</p>
            <button onClick={onClose}
              className="w-full bg-brand-600 text-white font-medium rounded-xl py-3 text-sm">
              OK
            </button>
          </div>
        )}

        {/* Phase: error */}
        {phase === 'error' && (
          <div className="space-y-3">
            <p className="text-sm text-red-500">{t.reportError}</p>
            <button onClick={() => setPhase('input')}
              className="w-full border border-gray-200 dark:border-gray-600 text-ios-label
                         dark:text-dark-label font-medium rounded-xl py-3 text-sm">
              {t.reportCorrect}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Export FeedbackModal from packages/shared/index.js**

In `packages/shared/index.js`, add with the other component exports:

```js
export { default as FeedbackModal } from './components/FeedbackModal.jsx';
```

- [ ] **Step 4: Commit**

```bash
git add packages/shared/components/FeedbackModal.jsx \
        packages/shared/index.js \
        apps/florist/src/translations.js \
        apps/dashboard/src/translations.js \
        apps/delivery/src/translations.js
git commit -m "feat(feedback): FeedbackModal shared component + translation keys in all 3 apps"
```

---

### Task 8: Florist app Report button

**Files:**
- Modify: `apps/florist/src/components/BottomNav.jsx`

- [ ] **Step 1: Add the Report item to the More menu**

In `apps/florist/src/components/BottomNav.jsx`:

1. Add import at the top of the file (in the lucide-react import block):

```js
import { MessageSquareWarning } from 'lucide-react';
```

2. Add state for the modal at the top of the `BottomNav` function body (after `const [moreOpen, setMoreOpen] = useState(false);`):

```js
const [reportOpen, setReportOpen] = useState(false);
```

3. In the `moreItems` array, add a Report entry at the top:

```js
const moreItems = [
  { Icon: MessageSquareWarning, label: t.reportButton, action: () => setReportOpen(true) },
  ...floristOnlyItems,
  // ... rest unchanged
```

4. At the bottom of the return, just before the closing `</>`, add the modal mount:

```jsx
{reportOpen && (
  <FeedbackModal
    t={t}
    apiClient={client}
    reporterRole={role}
    reporterName={role === 'owner' ? 'Owner' : 'Florist'}
    appArea="florist"
    onClose={() => setReportOpen(false)}
  />
)}
```

5. Add the necessary imports at the top of the file:

```js
import { FeedbackModal } from '../../../packages/shared/index.js';
import client from '../api/client.js';
```

Wait — the florist app imports shared components via the workspace, not with a relative path. Check how other shared components are imported in the florist app:

```bash
grep -n "from.*shared" apps/florist/src/components/BottomNav.jsx | head -5
grep -n "FeedbackModal\|from.*shared" apps/florist/src/components/DissolvePremadesDialog.jsx 2>/dev/null | head -5
grep -rn "from.*shared" apps/florist/src/components/ | head -5
```

Use whatever pattern you find. It's likely `from '@flower-studio/shared'` or `from 'packages/shared/index.js'`. Check `apps/florist/package.json` for the workspace dependency name.

- [ ] **Step 2: Build florist app to verify no import errors**

```bash
cd apps/florist && ./node_modules/.bin/vite build 2>&1 | tail -20
```

Expected: build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/florist/src/components/BottomNav.jsx
git commit -m "feat(feedback): Report button in Florist app BottomNav More menu"
```

---

## Phase 5 — Screenshots + Dashboard + Delivery (implements #241 + #242)

### Task 9: Screenshot upload — GitHub Contents API

**Files:**
- Modify: `backend/src/services/feedbackService.js`

The `FeedbackModal` already has the file input UI (Task 7). The backend needs to upload the image to GitHub before creating the issue.

- [ ] **Step 1: Add githubUploadImage to feedbackService.js**

Add this function after `githubCreateIssue`:

```js
/**
 * Upload an image buffer to the repo as a file in feedback-screenshots/.
 * Returns the raw.githubusercontent.com URL for embedding in the issue body.
 */
async function githubUploadImage(buffer, filename) {
  const token = process.env.GITHUB_TOKEN;
  const ext = filename?.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `feedback-screenshots/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const content = buffer.toString('base64');

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        message: `chore: add feedback screenshot ${path}`,
        content,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error('[FEEDBACK] image upload failed:', err);
    return null; // graceful degradation — issue still created without image
  }

  return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/master/${path}`;
}
```

- [ ] **Step 2: Use image URL in publishSession**

Update the `publishSession` function to upload the image first, then embed the URL in the body. Replace the `publishSession` function:

```js
export async function publishSession(sessionId, imageBuffer = null, imageFilename = null) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found or expired');
  if (!session.done) throw new Error('Session not complete — preview first');

  let imageUrl = null;
  if (imageBuffer) {
    imageUrl = await githubUploadImage(imageBuffer, imageFilename);
  }

  const issueBody = buildIssueBody(session, imageUrl);
  const issueNumber = await githubCreateIssue(session.title, issueBody);
  const issueUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}`;

  await db.insert(feedbackReports).values({
    githubIssueNumber: issueNumber,
    reporterRole:      session.reporterRole,
    reporterName:      session.reporterName,
    telegramChatId:    session.telegramChatId || null,
  });

  sessions.delete(sessionId);
  return { issueUrl, issueNumber };
}
```

- [ ] **Step 3: Update buildIssueBody to embed actual URL**

Replace `buildIssueBody`:

```js
function buildIssueBody(session, imageUrl = null) {
  const acs = session.acceptanceCriteria?.length > 0
    ? session.acceptanceCriteria.map(c => `- [ ] ${c}`).join('\n')
    : '- [ ] (To be defined during implementation)';

  const imageSection = imageUrl
    ? `\n## Screenshot\n\n![screenshot](${imageUrl})\n`
    : '';

  return `## What to build

${session.englishDescription}
${imageSection}
## Acceptance criteria

${acs}

## Blocked by

None

---
_Reported by ${session.reporterName} (${session.reporterRole})${session.appArea ? ` via ${session.appArea}` : ''}_
_Original text: "${session.originalQuote}"_`;
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && npx vitest run src/__tests__/feedbackService.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/feedbackService.js
git commit -m "feat(feedback): screenshot upload via GitHub Contents API, embedded in issue body"
```

---

### Task 10: Dashboard + Delivery app Report buttons

**Files:**
- Modify: `apps/dashboard/src/pages/DashboardPage.jsx`
- Modify: `apps/delivery/src/pages/DeliveryListPage.jsx`

Before implementing, check the shared import pattern used in each app:

```bash
grep -rn "from.*shared\|FeedbackModal" apps/dashboard/src/ | head -5
grep -rn "from.*shared\|FeedbackModal" apps/delivery/src/ | head -5
```

- [ ] **Step 1: Add Report button to Dashboard header**

In `apps/dashboard/src/pages/DashboardPage.jsx`:

1. Import at top:

```js
import { useState } from 'react'; // already imported — just add FeedbackModal + MessageSquareWarning
import { MessageSquareWarning } from 'lucide-react';
import { FeedbackModal } from '<shared-import-path>'; // use pattern from grep above
import client from '../api/client.js'; // check actual import path
import { useAuth } from '../context/AuthContext.jsx';
```

2. In the component body, add state:

```js
const [reportOpen, setReportOpen] = useState(false);
const { role } = useAuth();
```

3. In the header (`<div className="flex items-center gap-2">`), add before the existing buttons:

```jsx
<button
  onClick={() => setReportOpen(true)}
  className="text-xs font-bold h-7 px-2.5 rounded-lg bg-gray-100 text-gray-500
             hover:bg-gray-200 transition-colors flex items-center gap-1.5"
  title={t.reportButton}
>
  <MessageSquareWarning size={14} />
  <span className="hidden sm:inline">{t.reportButton}</span>
</button>
```

4. At the end of the return (before the closing `</div>`), add:

```jsx
{reportOpen && (
  <FeedbackModal
    t={t}
    apiClient={client}
    reporterRole={role}
    reporterName="Owner"
    appArea="dashboard"
    onClose={() => setReportOpen(false)}
  />
)}
```

- [ ] **Step 2: Add Report button to Delivery app header**

In `apps/delivery/src/pages/DeliveryListPage.jsx`:

1. Import at top:

```js
import { MessageSquareWarning } from 'lucide-react';
import { FeedbackModal } from '<shared-import-path>';
import { useAuth } from '../context/AuthContext.jsx'; // check actual path
```

2. In the component body add state:

```js
const [reportOpen, setReportOpen] = useState(false);
const { role, driverName } = useAuth(); // check what useAuth exposes in delivery app
```

3. In the header button cluster (the `<div className="flex items-center gap-2">` that has the refresh and help buttons), add:

```jsx
<button
  onClick={() => setReportOpen(true)}
  className="text-xs font-bold w-7 h-7 rounded-lg bg-gray-100 text-gray-500
             hover:bg-gray-200 transition-colors flex items-center justify-center"
  title={t.reportButton}
>
  <MessageSquareWarning size={14} />
</button>
```

4. At the end of the return, add the modal:

```jsx
{reportOpen && (
  <FeedbackModal
    t={t}
    apiClient={client}
    reporterRole="driver"
    reporterName={driverName || 'Driver'}
    appArea="delivery"
    onClose={() => setReportOpen(false)}
  />
)}
```

Check `useAuth` in the delivery app context to see what field the driver name is stored under. If it's not `driverName`, adjust accordingly.

- [ ] **Step 3: Build all three apps**

```bash
cd apps/florist && ./node_modules/.bin/vite build 2>&1 | tail -5
cd apps/dashboard && ./node_modules/.bin/vite build 2>&1 | tail -5
cd apps/delivery && ./node_modules/.bin/vite build 2>&1 | tail -5
```

All three must succeed with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/pages/DashboardPage.jsx \
        apps/delivery/src/pages/DeliveryListPage.jsx
git commit -m "feat(feedback): Report button in Dashboard header and Delivery app header"
```

---

## Phase 6 — Telegram + Close Notifications (implements #243 + #244)

### Task 11: Telegram feedback bot

**Files:**
- Create: `backend/src/services/feedbackTelegramBot.js`
- Modify: `backend/src/index.js`
- Modify: `.env.example`

The bot uses long-polling (same style as the existing notification bot), routing messages to `feedbackService`. Owner registers with `/start <PIN>` to link their Telegram chat ID.

- [ ] **Step 1: Create feedbackTelegramBot.js**

Create `backend/src/services/feedbackTelegramBot.js`:

```js
import * as feedbackService from './feedbackService.js';
import { db } from '../db/index.js';
import { feedbackReports } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const BASE = 'https://api.telegram.org/bot';
let offset = 0;
let running = false;
let pollTimer = null;

/**
 * Send a text message to a Telegram chat.
 */
async function send(token, chatId, text) {
  try {
    const res = await fetch(`${BASE}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) console.error('[FEEDBACK_BOT] send failed:', await res.text());
  } catch (err) {
    console.error('[FEEDBACK_BOT] send error:', err.message);
  }
}

/**
 * Handle a single incoming Telegram update.
 */
async function handleUpdate(token, update) {
  const msg = update.message;
  if (!msg) return;

  const chatId = String(msg.chat.id);
  const text = msg.text?.trim() || '';

  // /start <PIN> — register this chat ID as the owner's feedback channel
  if (text.startsWith('/start')) {
    const pin = text.split(' ')[1];
    const ownerPin = process.env.PIN_OWNER;
    if (pin === ownerPin) {
      // Store chat ID in a config row so the close-notification webhook can find it
      await db.insert(feedbackReports)
        .values({ githubIssueNumber: 0, reporterRole: 'owner', reporterName: 'Owner', telegramChatId: chatId })
        .onConflictDoNothing();
      await send(token, chatId, 'Привет! Telegram-канал для отчётов зарегистрирован. Напишите любое сообщение, чтобы сообщить об ошибке или пожелании.');
    } else {
      await send(token, chatId, 'Неверный PIN. Попробуйте ещё раз: /start <PIN>');
    }
    return;
  }

  // Route all other messages through feedbackService
  await routeMessage(token, chatId, text);
}

// In-memory map: chatId → sessionId for ongoing conversations
const chatSessions = new Map();

async function routeMessage(token, chatId, text) {
  const existingSession = chatSessions.get(chatId);

  try {
    if (!existingSession) {
      // Start a new session
      const result = await feedbackService.startSession({
        text,
        appArea: 'telegram',
        reporterRole: 'owner',
        reporterName: 'Owner',
      });
      chatSessions.set(chatId, result.sessionId);
      // Attach telegramChatId so close notifications work
      const session = feedbackService.sessions.get(result.sessionId);
      if (session) session.telegramChatId = chatId;

      if (result.done) {
        await handleSessionDone(token, chatId, result.sessionId);
      } else {
        await send(token, chatId, result.question);
      }
    } else {
      // Continue existing session
      const result = await feedbackService.continueSession(existingSession, text);
      if (result.done) {
        await handleSessionDone(token, chatId, existingSession);
      } else {
        await send(token, chatId, result.question);
      }
    }
  } catch (err) {
    console.error('[FEEDBACK_BOT] routeMessage error:', err.message);
    chatSessions.delete(chatId);
    await send(token, chatId, 'Что-то пошло не так. Попробуйте написать снова.');
  }
}

async function handleSessionDone(token, chatId, sessionId) {
  const { summary } = await feedbackService.previewSession(sessionId);
  await send(token, chatId, `📋 Проверьте ваш отчёт:\n\n${summary}\n\nОтветьте "Отправить" для подтверждения или напишите исправление.`);
  chatSessions.set(chatId, `preview:${sessionId}`);
}

// Intercept "Отправить" confirmation
const CONFIRM_PHRASES = ['отправить', 'да', 'yes', 'подтвердить', 'confirm'];

async function routeConfirmation(token, chatId, text, sessionId) {
  const lower = text.toLowerCase();
  if (CONFIRM_PHRASES.some(p => lower.includes(p))) {
    const { issueUrl } = await feedbackService.publishSession(sessionId);
    chatSessions.delete(chatId);
    await send(token, chatId, `✅ Отчёт отправлен! ${issueUrl}`);
  } else {
    // Treat as correction — continue the session
    chatSessions.set(chatId, sessionId);
    const result = await feedbackService.continueSession(sessionId, text);
    if (result.done) {
      await handleSessionDone(token, chatId, sessionId);
    } else {
      await send(token, chatId, result.question);
    }
  }
}

async function poll(token) {
  if (!running) return;
  try {
    const res = await fetch(`${BASE}${token}/getUpdates?offset=${offset}&timeout=20`);
    if (!res.ok) { await sleep(5000); }
    else {
      const { result: updates } = await res.json();
      for (const update of updates) {
        offset = update.update_id + 1;
        const chatId = String(update.message?.chat?.id || '');
        const text = update.message?.text?.trim() || '';
        const existing = chatSessions.get(chatId);
        if (existing?.startsWith('preview:')) {
          await routeConfirmation(token, chatId, text, existing.slice(8));
        } else {
          await handleUpdate(token, update);
        }
      }
    }
  } catch (err) {
    console.error('[FEEDBACK_BOT] poll error:', err.message);
    await sleep(5000);
  }
  if (running) pollTimer = setTimeout(() => poll(token), 100);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function startFeedbackBot() {
  const token = process.env.FEEDBACK_BOT_TOKEN;
  if (!token) {
    console.log('[FEEDBACK_BOT] FEEDBACK_BOT_TOKEN not set — feedback Telegram bot disabled');
    return;
  }
  running = true;
  poll(token);
  console.log('[FEEDBACK_BOT] Feedback Telegram bot started');
}

export function stopFeedbackBot() {
  running = false;
  if (pollTimer) clearTimeout(pollTimer);
}
```

- [ ] **Step 2: Start the bot in index.js**

In `backend/src/index.js`, add after the existing Telegram import (or near the bottom of the imports):

```js
import { startFeedbackBot } from './services/feedbackTelegramBot.js';
```

Then in the server startup section (after `connectPostgres()` succeeds or in the `app.listen` callback), add:

```js
startFeedbackBot();
```

Find the existing place where the server starts (the `app.listen` call) and add it there. Look for `app.listen` in `index.js`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/feedbackTelegramBot.js backend/src/index.js
git commit -m "feat(feedback): Telegram feedback bot — /start PIN registration, AI conversation, publish confirmation"
```

---

### Task 12: GitHub close webhook for notifications

**Files:**
- Modify: `backend/src/routes/webhook.js`

- [ ] **Step 1: Add the GitHub issues close handler to webhook.js**

In `backend/src/routes/webhook.js`, add after the existing imports:

```js
import * as feedbackRepo from '../repos/feedbackRepo.js';
```

Wait — instead of creating a new repo file, use the db/schema directly in webhook.js since this is a simple lookup:

```js
import { db } from '../db/index.js';
import { feedbackReports } from '../db/schema.js';
import { eq } from 'drizzle-orm';
```

Then add a new route after the existing Wix webhook route:

```js
// GitHub issues webhook — fires when an issue is closed.
// Notifies the reporter via Telegram if a chat_id is stored.
router.post('/github', express.json(), async (req, res) => {
  const event = req.headers['x-github-event'];
  if (event !== 'issues') return res.json({ ok: true });

  const { action, issue } = req.body;
  if (action !== 'closed' || !issue?.number) return res.json({ ok: true });

  res.json({ ok: true }); // Respond immediately — Telegram send is async

  try {
    const [row] = await db
      .select({ telegramChatId: feedbackReports.telegramChatId })
      .from(feedbackReports)
      .where(eq(feedbackReports.githubIssueNumber, issue.number));

    if (!row?.telegramChatId) return;

    const token = process.env.FEEDBACK_BOT_TOKEN;
    if (!token) return;

    const text = `✅ Проблема исправлена!\n\nВаш отчёт #${issue.number} «${issue.title}» закрыт.\n${issue.html_url}`;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: row.telegramChatId, text }),
    });
  } catch (err) {
    console.error('[WEBHOOK] GitHub close notification error:', err.message);
  }
});
```

Note: This route does NOT verify a webhook secret because GitHub issues webhooks don't support HMAC by default (only push/PR webhooks do). If you add a secret in the GitHub webhook settings, add verification following the same `verifyWixSignature` pattern at the top of `webhook.js`.

Also make sure `express.json()` is not duplicated — check if the file already applies `express.json()` globally before this router. If it does, remove the `express.json()` from this specific route.

- [ ] **Step 2: Configure the GitHub webhook**

This step is HITL (requires owner action):
1. Go to `https://github.com/OliwerO/flower-studio/settings/hooks/new`
2. Payload URL: `https://<railway-backend-url>/api/webhook/github`
3. Content type: `application/json`
4. Events: select "Issues" only
5. Active: checked

- [ ] **Step 3: Run all backend tests**

```bash
cd backend && npx vitest run
```

Expected: all tests pass with no new failures.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/webhook.js
git commit -m "feat(feedback): GitHub issues close webhook → Telegram notification to reporter"
```

---

## Pre-PR Verification (mandatory before opening PR)

- [ ] **Backend tests:**

```bash
cd backend && npx vitest run
```

Expected: all pass, no new failures.

- [ ] **E2E suite:**

```bash
npm run harness &
sleep 3
npm run test:e2e
pkill -f start-test-backend
```

Expected: 153 assertions all pass.

- [ ] **Build all three apps:**

```bash
cd apps/florist && ./node_modules/.bin/vite build 2>&1 | tail -5
cd apps/dashboard && ./node_modules/.bin/vite build 2>&1 | tail -5
cd apps/delivery && ./node_modules/.bin/vite build 2>&1 | tail -5
```

All three must succeed.

- [ ] **CHANGELOG.md:**

Add an entry for the new `feedback_reports` table and the two new env vars (`GITHUB_TOKEN`, `FEEDBACK_BOT_TOKEN`).

- [ ] **BACKLOG.md:**

Check off the Report system items.

---

## Self-Review

**Spec coverage check:**

| Slice | Covered in tasks |
|-------|-----------------|
| #236 bare pipeline | Tasks 1–3 |
| #237 AI enrichment | Task 4 |
| #238 multi-turn | Task 5 |
| #239 preview | Task 6 |
| #240 in-app modal (florist) | Tasks 7–8 |
| #241 screenshot upload | Task 9 |
| #242 dashboard + delivery buttons | Task 10 |
| #243 Telegram bot | Task 11 |
| #244 close notifications | Task 12 |

**Known risks:**
- Task 8 and 10 have a "check the shared import path" step — the implementer must grep before assuming the import path. The florist app may use a workspace alias.
- Task 12 GitHub webhook requires owner to register the webhook in GitHub settings (HITL step).
- The `feedbackTelegramBot.js` session matching uses in-memory `chatSessions` Map — restarts clear it. Acceptable: conversations are < 5 min, deploys are rare.
- `githubUploadImage` fails gracefully (returns null) — issue is still created without the screenshot. Log the failure.
