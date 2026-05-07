import * as feedbackService from './feedbackService.js';
import { db } from '../db/index.js';
import { feedbackReports, feedbackSessions } from '../db/schema.js';
import { systemMeta } from '../db/schema.js';
import { eq, and, gt } from 'drizzle-orm';

const BASE = 'https://api.telegram.org/bot';

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

// In-memory map: chatId → sessionId (or 'preview:<sessionId>' awaiting confirmation)
const chatSessions = new Map();

const CONFIRM_PHRASES = ['отправить', 'да', 'yes', 'подтвердить', 'confirm', 'ок', 'ok'];

async function handleConfirmation(token, chatId, text, sessionId) {
  const lower = text.toLowerCase();
  if (CONFIRM_PHRASES.some(p => lower.includes(p))) {
    try {
      const { issueUrl } = await feedbackService.publishSession(sessionId);
      chatSessions.delete(chatId);
      await send(token, chatId, `✅ Отчёт отправлен!\n${issueUrl}`);
    } catch (err) {
      console.error('[FEEDBACK_BOT] publish error:', err.message);
      // Session still valid — keep chatId mapped so owner can retry
      await send(token, chatId, 'Не удалось отправить отчёт. Попробуйте написать "Отправить" ещё раз.');
    }
  } else {
    // Treat as correction — continue the conversation
    chatSessions.set(chatId, sessionId);
    try {
      const result = await feedbackService.continueSession(sessionId, text);
      if (result.done) {
        await showPreview(token, chatId, sessionId);
      } else {
        await send(token, chatId, result.question);
      }
    } catch (err) {
      console.error('[FEEDBACK_BOT] continue error:', err.message);
      // Keep chatSessions entry — transient error, owner can resend
      await send(token, chatId, 'Что-то пошло не так. Попробуйте написать ещё раз.');
    }
  }
}

async function showPreview(token, chatId, sessionId) {
  const { summary } = await feedbackService.previewSession(sessionId);
  chatSessions.set(chatId, `preview:${sessionId}`);
  await send(token, chatId,
    `📋 Проверьте ваш отчёт:\n\n${summary}\n\nОтветьте "Отправить" для подтверждения или напишите исправление.`
  );
}

// Find most recent active (non-published, non-expired) session for a Telegram chatId.
async function findActiveSessionForChat(chatId) {
  const now = new Date();
  const rows = await db.select({
    id:           feedbackSessions.id,
    done:         feedbackSessions.done,
    lastQuestion: feedbackSessions.lastQuestion,
    summary:      feedbackSessions.summary,
  }).from(feedbackSessions).where(
    and(
      eq(feedbackSessions.telegramChatId, chatId),
      eq(feedbackSessions.published, false),
      gt(feedbackSessions.expiresAt, now),
    )
  ).limit(1);
  return rows[0] ?? null;
}

async function routeMessage(token, chatId, text) {
  const existing = chatSessions.get(chatId);

  if (existing?.startsWith('preview:')) {
    return handleConfirmation(token, chatId, text, existing.slice(8));
  }

  try {
    if (!existing) {
      // Check DB for an active session from before a restart
      const activeRow = await findActiveSessionForChat(chatId);
      if (activeRow) {
        if (activeRow.done) {
          chatSessions.set(chatId, `preview:${activeRow.id}`);
          await showPreview(token, chatId, activeRow.id);
        } else {
          chatSessions.set(chatId, activeRow.id);
          // Re-ask the last question so the owner knows where they left off
          const q = activeRow.lastQuestion || 'Пожалуйста, продолжите описание.';
          await send(token, chatId, `(продолжаем ваш сеанс)\n\n${q}`);
        }
        return;
      }

      const result = await feedbackService.startSession({
        text,
        appArea: 'telegram',
        reporterRole: 'owner',
        reporterName: 'Owner',
        telegramChatId: chatId,
      });
      chatSessions.set(chatId, result.sessionId);

      if (result.done) {
        await showPreview(token, chatId, result.sessionId);
      } else {
        await send(token, chatId, result.question);
      }
    } else {
      const result = await feedbackService.continueSession(existing, text);
      if (result.done) {
        await showPreview(token, chatId, existing);
      } else {
        await send(token, chatId, result.question);
      }
    }
  } catch (err) {
    console.error('[FEEDBACK_BOT] route error:', err.message);
    // Keep chatSessions entry — transient error, owner can resend
    await send(token, chatId, 'Что-то пошло не так. Попробуйте написать снова.');
  }
}

async function handleUpdate(token, update) {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId = String(msg.chat.id);
  const text = msg.text.trim();

  if (text.startsWith('/start')) {
    const pin = text.split(' ')[1];
    if (pin === process.env.PIN_OWNER) {
      // Store chat ID association — insert a sentinel row (issue_number=0) to register owner chat
      try {
        await db.insert(feedbackReports).values({
          githubIssueNumber: 0,
          reporterRole: 'owner',
          reporterName: 'Owner',
          telegramChatId: chatId,
        });
      } catch (err) {
        console.error('[FEEDBACK_BOT] register error:', err.message);
      }
      await send(token, chatId, 'Привет! 👋 Бот для отчётов зарегистрирован. Напишите любое сообщение, чтобы сообщить о проблеме или пожелании.');
    } else {
      await send(token, chatId, 'Неверный PIN. Попробуйте: /start <PIN>');
    }
    return;
  }

  await routeMessage(token, chatId, text);
}

const POLL_OFFSET_KEY = 'telegram_poll_offset';

let running = false;
let pollOffset = 0;
let pollTimer = null;

async function savePollOffset() {
  try {
    await db.insert(systemMeta)
      .values({ key: POLL_OFFSET_KEY, value: String(pollOffset) })
      .onConflictDoUpdate({ target: systemMeta.key, set: { value: String(pollOffset) } });
  } catch (err) {
    console.error('[FEEDBACK_BOT] failed to save poll offset:', err.message);
  }
}

async function loadPollOffset() {
  try {
    const [row] = await db.select({ value: systemMeta.value })
      .from(systemMeta)
      .where(eq(systemMeta.key, POLL_OFFSET_KEY));
    if (row?.value) pollOffset = parseInt(row.value, 10) || 0;
  } catch (err) {
    console.error('[FEEDBACK_BOT] failed to load poll offset:', err.message);
  }
}

async function poll(token) {
  if (!running) return;
  try {
    const res = await fetch(`${BASE}${token}/getUpdates?offset=${pollOffset}&timeout=20`);
    if (res.ok) {
      const { result: updates } = await res.json();
      if (updates?.length) {
        for (const update of updates) {
          pollOffset = update.update_id + 1;
          await handleUpdate(token, update);
        }
        await savePollOffset();
      }
    }
  } catch (err) {
    console.error('[FEEDBACK_BOT] poll error:', err.message);
  }
  if (running) pollTimer = setTimeout(() => poll(token), 500);
}

export async function startFeedbackBot() {
  const token = process.env.FEEDBACK_BOT_TOKEN;
  if (!token) {
    console.log('[FEEDBACK_BOT] FEEDBACK_BOT_TOKEN not set — feedback Telegram bot disabled');
    return;
  }
  await loadPollOffset();
  running = true;
  poll(token);
  console.log('[FEEDBACK_BOT] Feedback Telegram bot started');
}

export function stopFeedbackBot() {
  running = false;
  if (pollTimer) clearTimeout(pollTimer);
}
