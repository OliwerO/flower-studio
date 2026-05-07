import crypto from 'node:crypto';
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
    // Last resort: find the outermost JSON object in the response
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]); } catch {}
    }
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
      summary: (aiResult.summary ?? aiResult.russianSummary) || text,
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
 * Process the reporter's reply. Appends their message, calls AI, updates session state.
 * Returns { done: false, question } or { done: true } when AI has enough info.
 */
export async function continueSession(sessionId, message) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found or expired');
  if (session.done) return { done: true };

  // Build candidate messages locally — only commit to session on success
  const nextMessages = [...session.messages];
  if (session.lastQuestion) {
    nextMessages.push({ role: 'assistant', content: session.lastQuestion });
  }
  nextMessages.push({ role: 'user', content: message });

  const aiResult = await callAI(nextMessages);

  // Commit only after successful AI response
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
    return { done: true };
  }

  session.lastQuestion = aiResult.question;
  return { done: false, question: aiResult.question };
}

/**
 * Return Russian summary for preview. Stub for Phase 1 — real preview added in Task 6.
 */
export async function previewSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found or expired');
  if (!session.done) throw new Error('Session not complete yet');
  return { summary: session.summary };
}

/**
 * Create the GitHub issue and write the feedback_reports row.
 * Returns { issueUrl, issueNumber }.
 */
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
    telegramChatId:    session.telegramChatId ?? null,
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

/**
 * Upload an image buffer to the repo under feedback-screenshots/.
 * Returns a raw.githubusercontent.com URL for embedding in the issue body.
 * Returns null on failure — issue is still created without the image.
 */
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
