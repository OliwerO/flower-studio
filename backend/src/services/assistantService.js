import Anthropic from '@anthropic-ai/sdk';
import crypto from 'node:crypto';
import { TOOL_DEFS, TOOL_HANDLERS } from './assistantTools/index.js';
import * as conversationRepo from '../repos/assistantConversationRepo.js';

const anthropic = new Anthropic();
const MODEL = process.env.ASSISTANT_MODEL || 'claude-sonnet-4-6';
// Max tool round-trips per question. Raised from 6 → 12 so multi-tool / "connect
// the dots" questions (call several tools, then reason) can complete instead of
// hitting the cap. Env-overridable for tuning without a deploy.
const MAX_ITERATIONS = Number(process.env.ASSISTANT_MAX_ITERATIONS) || 12;
const MAX_TOKENS = 2048;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const sessions = new Map(); // sessionId -> { messages, createdAt }

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
}, 10 * 60 * 1000).unref();

function systemPrompt(today) {
  return [
    "You are Blossom's analytics assistant for the studio owner. Blossom is a flower studio in Krakow.",
    `Today's date is ${today} (Europe/Warsaw). Resolve relative periods like "May", "last month", "this week" against it.`,
    'You answer questions about the business ONLY using the provided tools. Never write SQL.',
    'CRITICAL: State only numbers that came from a tool result. Never invent, estimate, or extrapolate figures.',
    "If no tool can directly answer the question: (1) say plainly that you don't have a dedicated tool for it, (2) then, if related tools returned useful data, give your best interpretation built ONLY on those real figures — clearly labelled as an interpretation/inference, not a measured number. Combine results from MULTIPLE tools when a question needs it (e.g. join orders with stock shortfalls, or spend with revenue) — call each tool, then reason over their real outputs to connect the dots.",
    'When a tool result has truncated=true, tell the user you are showing the first N of matchedCount and that they can ask to see all.',
    'Currency is Polish złoty — display amounts with "zł".',
    "BE BRIEF AND SPECIFIC. The owner wants a short overview she can read at a glance: the headline numbers and AT MOST one small summary table (a few key rows), never exhaustive detail. Answer exactly what was asked — do NOT volunteer extra analyses, side-notes, caveats, or 'would you like me to…' follow-up menus unless asked. NEVER paste a long row-by-row list (more than ~6 rows) into the chat: give the summary (counts, totals, top few) and hand the full list off to Explorer/Orders (see HANDOFF BUTTONS) where she can see and act on everything. The chat is the overview; Explorer/Orders is where she drills.",
    "LANGUAGE: reply in the SAME language as the user's latest message — if they write in English, answer entirely in English; if in Russian, answer in Russian. Only fall back to Russian when the language is genuinely unclear.",
    "When a tool result includes a 'period' field (or 'period1'/'period2' for compare_periods), state the resolved date range(s) back to the user before the numbers (e.g. 'For May 2026 (2026-05-01–2026-05-31): …') so a mis-parsed period is caught.",
    "Order counts and revenue EXCLUDE cancelled orders unless the user explicitly asks about cancellations — say so when it matters.",
    "Revenue 'flowers' is NET: total = flowers + delivery, always. Do not describe flower revenue as if it were gross.",
    "For ad spend (marketing_spend) vs revenue per source: channel names are free text and do not map exactly to Order Source, so do not state a precise ROAS — present spend and revenue side by side and note the caveat.",
    "HANDOFF BUTTONS: these are the PRIMARY way the owner drills into detail, so offer them generously — whenever your answer is backed by an underlying multi-row list she might want to see in full, save, or export (INCLUDING every time you were tempted to print a long table — replace that table with a short summary + a handoff). Rules: (1) For a list of ORDERS the owner may act on (e.g. 'which orders are unpaid', 'June's deliveries'), call open_orders_view with the same filters you used AND ALSO call open_explorer_view with the equivalent query_records spec — the UI shows BOTH buttons ('Open in Orders' to act on them, 'Open in Explorer' to see the full table + save the view / export CSV). Default to offering both for any order list. (2) For any OTHER entity or a cross-entity / connect-the-dots result (purchases, write-offs, customers, key people, deliveries, stock, …), call open_explorer_view with the query_records spec. (3) Do NOT signal for pure aggregate answers (a single total/average/count) with no natural underlying list to browse. (4) ALWAYS pass BOTH a Russian `label` and an English `labelEn` to these tools so the button reads in the app's current language.",
  ].join('\n');
}

// ── Prompt caching ──────────────────────────────────────────────────────────
// The system prompt + the 20 tool definitions are large and IDENTICAL on every
// turn. Marking them cacheable lets Anthropic serve them from its prompt cache
// (~10% of normal input-token cost) on the 2nd+ request within the 5-minute TTL —
// big savings on the multi-tool loop (several create() calls per question) and on
// multi-turn chats. Prompt caching is GA on SDK 0.78 (no beta header needed).
// A cache breakpoint caches everything up to AND including the block it's on.
const CACHE_CONTROL = { type: 'ephemeral' };

// One breakpoint on the LAST tool def → the whole tools block (all 20) is cached.
const CACHED_TOOLS = TOOL_DEFS.map((t, i) =>
  i === TOOL_DEFS.length - 1 ? { ...t, cache_control: CACHE_CONTROL } : t,
);

// System as a single cacheable text block. It changes only with `today`, so the
// cache is valid for the whole day — every turn within a session reuses it.
function cachedSystem(today) {
  return [{ type: 'text', text: systemPrompt(today), cache_control: CACHE_CONTROL }];
}

// First user message → conversation title, trimmed to 80 chars.
function deriveTitle(messages) {
  const firstUser = (messages || []).find(m => m.role === 'user' && typeof m.content === 'string');
  const raw = (firstUser?.content || '').trim();
  if (!raw) return '';
  return raw.length > 80 ? raw.slice(0, 80).trimEnd() + '…' : raw;
}

// Signal tools whose output the UI turns into an "Open in …" handoff button.
// Their result must survive the display projection so a reopened chat keeps the
// button (Explorer v2 #497) — every other tool block is display-irrelevant.
const SIGNAL_TOOLS = new Set(['open_orders_view', 'open_explorer_view']);

function safeParseToolResult(content) {
  if (typeof content !== 'string') return content && typeof content === 'object' ? content : null;
  try { return JSON.parse(content); } catch { return null; }
}

// Project the canonical Anthropic message array to UI display turns:
// keep user text + assistant text, drop tool_use / tool_result blocks — EXCEPT
// the signal tools, whose {name, output} is reconstructed from the stored
// tool_use / tool_result pair and attached to the next answer turn (matching the
// live path, which attaches toolResults to the final answer message).
export function toDisplayTurns(messages) {
  const arr = messages || [];
  const turns = [];
  let pendingSignals = [];
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i];
    if (m.role === 'user') {
      // Only string-content user turns are real user text; tool_result turns
      // (array content) are consumed alongside their assistant tool_use turn.
      if (typeof m.content === 'string') turns.push({ role: 'user', text: m.content });
    } else if (m.role === 'assistant') {
      const blocks = Array.isArray(m.content) ? m.content : null;
      if (blocks) {
        const signalUses = blocks.filter(b => b.type === 'tool_use' && SIGNAL_TOOLS.has(b.name));
        if (signalUses.length) {
          const next = arr[i + 1];
          const resultBlocks = next && next.role === 'user' && Array.isArray(next.content) ? next.content : [];
          for (const use of signalUses) {
            const res = resultBlocks.find(b => b.type === 'tool_result' && b.tool_use_id === use.id);
            const output = res ? safeParseToolResult(res.content) : null;
            if (output && !output.error) pendingSignals.push({ name: use.name, output });
          }
        }
      }
      const text = typeof m.content === 'string'
        ? m.content
        : (blocks ? blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim() : '');
      if (text) {
        const turn = { role: 'assistant', text };
        if (pendingSignals.length) { turn.toolResults = pendingSignals; pendingSignals = []; }
        turns.push(turn);
      }
    }
  }
  return turns;
}

export async function ask({ sessionId, message }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
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
  session.messages.push({ role: 'user', content: message });

  const toolResults = [];
  let iterations = 0;
  let response = await anthropic.messages.create({
    model: MODEL, max_tokens: MAX_TOKENS, system: cachedSystem(today), tools: CACHED_TOOLS, messages: [...session.messages],
  });

  while (response.stop_reason === 'tool_use' && iterations < MAX_ITERATIONS) {
    iterations++;
    session.messages.push({ role: 'assistant', content: response.content });
    const resultBlocks = [];
    for (const block of response.content.filter(b => b.type === 'tool_use')) {
      const handler = TOOL_HANDLERS[block.name];
      let output;
      try {
        output = handler ? await handler(block.input) : { error: `Unknown tool: ${block.name}` };
      } catch (err) {
        console.error(`[ASSISTANT] tool ${block.name} failed:`, err);
        output = { error: err.message };
      }
      toolResults.push({ name: block.name, input: block.input, output });
      resultBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(output) });
    }
    session.messages.push({ role: 'user', content: resultBlocks });
    response = await anthropic.messages.create({
      model: MODEL, max_tokens: MAX_TOKENS, system: cachedSystem(today), tools: CACHED_TOOLS, messages: [...session.messages],
    });
  }

  const CAP_FALLBACK = 'Превышен лимит итераций инструментов — попробуйте переформулировать вопрос.';
  let answer;
  if (response.stop_reason === 'tool_use') {
    // Iteration cap hit mid-tool-use. Do NOT persist the dangling tool_use turn —
    // the Anthropic API requires every assistant tool_use turn to be immediately
    // followed by a user turn with matching tool_result blocks. Persisting it here
    // would 400 the next ask() call on this session.
    answer = CAP_FALLBACK;
    session.messages.push({ role: 'assistant', content: answer });
  } else {
    session.messages.push({ role: 'assistant', content: response.content });
    answer = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || CAP_FALLBACK;
  }
  try {
    await conversationRepo.upsert({ id: sessionId, title: deriveTitle(session.messages), messages: session.messages });
  } catch (err) {
    console.error('[ASSISTANT] failed to persist conversation:', err);
  }
  return { sessionId, answer, toolResults };
}

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
