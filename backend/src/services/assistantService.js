import Anthropic from '@anthropic-ai/sdk';
import crypto from 'node:crypto';
import { TOOL_DEFS, TOOL_HANDLERS } from './assistantTools/index.js';

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
    'Currency is Polish złoty — display amounts with "zł". Answer in the same language the user wrote in (default Russian). Present breakdowns as compact Markdown tables.',
  ].join('\n');
}

export async function ask({ sessionId, message }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
  let session = sessionId ? sessions.get(sessionId) : null;
  if (!session) {
    sessionId = crypto.randomUUID();
    session = { messages: [], createdAt: Date.now() };
    sessions.set(sessionId, session);
  }
  session.messages.push({ role: 'user', content: message });

  const toolResults = [];
  let iterations = 0;
  let response = await anthropic.messages.create({
    model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt(today), tools: TOOL_DEFS, messages: session.messages,
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
      model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt(today), tools: TOOL_DEFS, messages: session.messages,
    });
  }

  session.messages.push({ role: 'assistant', content: response.content });
  const answer = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
    || 'Превышен лимит итераций инструментов — попробуйте переформулировать вопрос.';
  return { sessionId, answer, toolResults };
}
