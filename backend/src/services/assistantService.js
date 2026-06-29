import Anthropic from '@anthropic-ai/sdk';
import crypto from 'node:crypto';
import { TOOL_DEFS, TOOL_HANDLERS } from './assistantTools/index.js';
import * as conversationRepo from '../repos/assistantConversationRepo.js';

const anthropic = new Anthropic();
const MODEL = process.env.ASSISTANT_MODEL || 'claude-sonnet-4-6';
const MAX_ITERATIONS = 6;
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
    'CRITICAL: State only numbers that came from a tool result. Never invent, estimate, or extrapolate figures. If no tool can answer the question, say so plainly.',
    'When a tool result has truncated=true, tell the user you are showing the first N of matchedCount and that they can ask to see all.',
    'Currency is Polish złoty — display amounts with "zł". Present breakdowns as compact Markdown tables.',
    "LANGUAGE: reply in the SAME language as the user's latest message — if they write in English, answer entirely in English; if in Russian, answer in Russian. Only fall back to Russian when the language is genuinely unclear.",
  ].join('\n');
}

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
    model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt(today), tools: TOOL_DEFS, messages: [...session.messages],
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
      model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt(today), tools: TOOL_DEFS, messages: [...session.messages],
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
