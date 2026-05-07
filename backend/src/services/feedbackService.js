import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/index.js';
import { feedbackReports } from '../db/schema.js';

const GITHUB_OWNER = 'OliwerO';
const GITHUB_REPO  = 'flower-studio';
const MODEL = 'claude-haiku-4-5-20251001';

// In-memory session store. Sessions expire after 30 minutes.
const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}, 5 * 60 * 1000).unref();

function newSessionId() {
  return crypto.randomUUID();
}

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

Ask ONE clarifying question at a time in plain Russian. Keep questions short with a concrete example.
When you have enough information, respond with done:true and all fields.

ALWAYS respond with valid JSON only — no markdown fences, no extra text:

If more info needed:
{"done": false, "question": "Russian question string"}

When complete:
{"done": true, "type": "bug", "englishTitle": "Short English title under 70 chars", "englishDescription": "Clear English description of the problem and context", "acceptanceCriteria": ["English criterion 1", "English criterion 2"], "originalQuote": "reporter's exact words", "russianSummary": "Plain Russian summary of what will be submitted — 2-3 sentences"}`;

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
    return { done: false, question: 'Извините, что-то пошло не так. Пожалуйста, опишите проблему ещё раз.' };
  }
}

/**
 * Start a new Report session. Calls Claude Haiku to classify and format the report.
 * Returns { sessionId, done: true } if AI has enough info, or { sessionId, done: false, question } if more info needed.
 */
export async function startSession({ text, appArea, reporterRole, reporterName }) {
  const sessionId = newSessionId();
  const messages = [{ role: 'user', content: text }];

  const aiResult = await callAI(messages);

  const session = {
    reporterRole,
    reporterName,
    appArea: appArea || null,
    messages,
    createdAt: Date.now(),
    lastQuestion: null,
  };

  if (aiResult.done) {
    Object.assign(session, {
      done: true,
      title: (aiResult.englishTitle || text).replace(/\s+/g, ' ').trim().slice(0, 80),
      englishDescription: aiResult.englishDescription || text,
      acceptanceCriteria: aiResult.acceptanceCriteria || [],
      originalQuote: aiResult.originalQuote || text,
      russianSummary: aiResult.russianSummary || text,
      type: aiResult.type || 'bug',
    });
    sessions.set(sessionId, session);
    return { sessionId, done: true };
  }

  Object.assign(session, { done: false });
  session.lastQuestion = aiResult.question;
  sessions.set(sessionId, session);
  return { sessionId, done: false, question: aiResult.question };
}

/**
 * Continue an existing session. Stub for Phase 1 — AI multi-turn added in Task 5.
 * Returns { done: true } immediately since Phase 1 sessions are always complete.
 */
export async function continueSession(sessionId, message) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found or expired');
  return { done: true };
}

/**
 * Return Russian summary for preview. Stub for Phase 1 — real preview added in Task 6.
 */
export async function previewSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found or expired');
  if (!session.done) throw new Error('Session not complete yet');
  return { summary: session.russianSummary };
}

/**
 * Create the GitHub issue and write the feedback_reports row.
 * Returns { issueUrl, issueNumber }.
 */
export async function publishSession(sessionId, imageBuffer = null, imageFilename = null) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found or expired');
  if (!session.done) throw new Error('Session not complete — preview first');

  const issueBody = buildIssueBody(session, null);

  const issueNumber = await githubCreateIssue(session.title, issueBody);
  const issueUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}`;

  await db.insert(feedbackReports).values({
    githubIssueNumber: issueNumber,
    reporterRole:      session.reporterRole,
    reporterName:      session.reporterName,
    telegramChatId:    null, // set by feedbackTelegramBot when session originates from Telegram (Task 11)
  });

  sessions.delete(sessionId);
  return { issueUrl, issueNumber };
}

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

> ${session.originalQuote.replace(/\n/g, '\n> ')}`;
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
