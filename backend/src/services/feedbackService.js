import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { eq, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { feedbackReports, feedbackSessions } from '../db/schema.js';

const GITHUB_OWNER = 'OliwerO';
const GITHUB_REPO  = 'flower-studio';
const MODEL = 'claude-haiku-4-5-20251001';
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// In-memory cache — write-through, rebuilt from DB on cache miss.
const sessions = new Map();

// Prune expired rows from DB every 10 minutes.
setInterval(async () => {
  try {
    await db.delete(feedbackSessions).where(lt(feedbackSessions.expiresAt, new Date()));
  } catch (err) {
    console.error('[FEEDBACK] session prune error:', err.message);
  }
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}, 10 * 60 * 1000).unref();

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

Ask ONE clarifying question at a time. Keep questions short with a concrete example.
IMPORTANT: Respond in the SAME language the reporter used. If they write in Russian, respond in Russian. If English, respond in English. Match their language exactly.
When you have enough information, respond with done:true and all fields.

ALWAYS respond with valid JSON only — no markdown fences, no extra text:

If more info needed:
{"done": false, "question": "question in reporter's language"}

When complete:
{"done": true, "type": "bug", "englishTitle": "Short English title under 70 chars", "englishDescription": "Clear English description of the problem and context", "acceptanceCriteria": ["English criterion 1", "English criterion 2"], "originalQuote": "reporter's exact words", "summary": "Plain summary in reporter's language — 2-3 sentences"}
Note: "type" must be exactly "bug" or "feature" — no other values.`;

async function callAI(messages) {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages,
  });

  const raw = res.content[0]?.text || '{}';
  // Haiku occasionally wraps JSON in ```json ... ``` despite instructions — strip fences.
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const text = fenceMatch ? fenceMatch[1] : raw;
  try {
    return JSON.parse(text);
  } catch {
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]); } catch {}
    }
    return { done: false, question: 'Извините, что-то пошло не так. Пожалуйста, опишите проблему ещё раз.' };
  }
}

// Load session from DB into memory cache. Returns null if not found/expired/published.
async function loadFromDb(sessionId) {
  const rows = await db.select().from(feedbackSessions)
    .where(eq(feedbackSessions.id, sessionId))
    .limit(1);

  if (!rows.length) return null;
  const row = rows[0];
  if (row.published || row.expiresAt < new Date()) return null;

  const session = {
    reporterRole:       row.reporterRole,
    reporterName:       row.reporterName,
    appArea:            row.appArea,
    messages:           row.messages,
    lastQuestion:       row.lastQuestion,
    done:               row.done,
    title:              row.title,
    englishDescription: row.englishDescription,
    acceptanceCriteria: row.acceptanceCriteria,
    originalQuote:      row.originalQuote,
    summary:            row.summary,
    type:               row.type,
    telegramChatId:     row.telegramChatId,
    createdAt:          row.createdAt.getTime(),
  };
  sessions.set(sessionId, session);
  return session;
}

async function getSession(sessionId) {
  return sessions.get(sessionId) ?? await loadFromDb(sessionId);
}

async function persistSession(sessionId, session) {
  await db.update(feedbackSessions).set({
    messages:           session.messages,
    lastQuestion:       session.lastQuestion ?? null,
    done:               session.done,
    title:              session.title ?? null,
    englishDescription: session.englishDescription ?? null,
    acceptanceCriteria: session.acceptanceCriteria ?? null,
    originalQuote:      session.originalQuote ?? null,
    summary:            session.summary ?? null,
    type:               session.type ?? null,
    telegramChatId:     session.telegramChatId ?? null,
  }).where(eq(feedbackSessions.id, sessionId));
}

/**
 * Start a new Report session. Calls Claude Haiku to classify and format the report.
 * Returns { sessionId, done: true } if AI has enough info, or { sessionId, done: false, question } if more info needed.
 */
export async function startSession({ text, appArea, reporterRole, reporterName, telegramChatId = null }) {
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
    telegramChatId,
  };

  if (aiResult.done) {
    Object.assign(session, {
      done: true,
      title: (aiResult.englishTitle || text).replace(/\s+/g, ' ').trim().slice(0, 80),
      englishDescription: aiResult.englishDescription || text,
      acceptanceCriteria: aiResult.acceptanceCriteria || [],
      originalQuote: aiResult.originalQuote || text,
      summary: (aiResult.summary ?? aiResult.russianSummary) || text,
      type: aiResult.type || 'bug',
    });
  } else {
    Object.assign(session, { done: false });
    session.lastQuestion = aiResult.question;
  }

  sessions.set(sessionId, session);

  await db.insert(feedbackSessions).values({
    id:                 sessionId,
    reporterRole,
    reporterName,
    appArea:            session.appArea,
    messages:           session.messages,
    lastQuestion:       session.lastQuestion ?? null,
    done:               session.done,
    title:              session.title ?? null,
    englishDescription: session.englishDescription ?? null,
    acceptanceCriteria: session.acceptanceCriteria ?? null,
    originalQuote:      session.originalQuote ?? null,
    summary:            session.summary ?? null,
    type:               session.type ?? null,
    telegramChatId:     telegramChatId ?? null,
    expiresAt:          new Date(Date.now() + SESSION_TTL_MS),
  });

  return {
    sessionId,
    done: session.done,
    ...(session.done ? {} : { question: session.lastQuestion }),
  };
}

/**
 * Process the reporter's reply. Appends their message, calls AI, updates session state.
 * Returns { done: false, question } or { done: true } when AI has enough info.
 */
export async function continueSession(sessionId, message) {
  const session = await getSession(sessionId);
  if (!session) throw new Error('Session not found or expired');
  if (session.done) return { done: true };

  const nextMessages = [...session.messages];
  if (session.lastQuestion) {
    nextMessages.push({ role: 'assistant', content: session.lastQuestion });
  }
  nextMessages.push({ role: 'user', content: message });

  const aiResult = await callAI(nextMessages);

  session.messages = nextMessages;
  session.lastQuestion = null;

  if (aiResult.done) {
    Object.assign(session, {
      done: true,
      title: (aiResult.englishTitle || message).replace(/\s+/g, ' ').trim().slice(0, 80),
      englishDescription: aiResult.englishDescription || message,
      acceptanceCriteria: aiResult.acceptanceCriteria || [],
      originalQuote: aiResult.originalQuote || nextMessages[0]?.content || message,
      summary: (aiResult.summary ?? aiResult.russianSummary) || message,
      type: aiResult.type || 'bug',
    });
  } else {
    session.lastQuestion = aiResult.question;
  }

  await persistSession(sessionId, session);
  return session.done ? { done: true } : { done: false, question: session.lastQuestion };
}

/**
 * Return summary for preview before publishing.
 */
export async function previewSession(sessionId) {
  const session = await getSession(sessionId);
  if (!session) throw new Error('Session not found or expired');
  if (!session.done) throw new Error('Session not complete yet');
  return { summary: session.summary };
}

/**
 * Create the GitHub issue and write the feedback_reports row.
 * Returns { issueUrl, issueNumber }.
 */
export async function publishSession(sessionId, imageBuffer = null, imageFilename = null) {
  const session = await getSession(sessionId);
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
    telegramChatId:    session.telegramChatId ?? null,
  });

  await db.update(feedbackSessions)
    .set({ published: true })
    .where(eq(feedbackSessions.id, sessionId));

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

async function githubUploadImage(buffer, filename) {
  const token = process.env.GITHUB_TOKEN;
  const ext = (filename?.split('.').pop()?.toLowerCase()) || 'jpg';
  const path = `feedback-screenshots/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const content = buffer.toString('base64');

  try {
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
      return null;
    }

    return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/master/${path}`;
  } catch (err) {
    console.error('[FEEDBACK] image upload error:', err.message);
    return null;
  }
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
