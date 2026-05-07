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
}, 5 * 60 * 1000);

function newSessionId() {
  return crypto.randomUUID();
}

/**
 * Start a new Report session. In Phase 1 (no AI), marks done immediately.
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

  const issueBody = buildIssueBody(session, null);

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
