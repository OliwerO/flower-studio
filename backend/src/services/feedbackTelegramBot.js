import * as feedbackService from './feedbackService.js';
import { db } from '../db/index.js';
import { feedbackReports, feedbackSessions, systemMeta } from '../db/schema.js';
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

// In-memory map: chatId → { reporterRole, reporterName } — populated on /start and on startup.
const chatReporters = new Map();

const REPORTERS = {
  [process.env.PIN_OWNER]: { reporterRole: 'owner', reporterName: 'Owner', lang: 'ru' },
  [process.env.PIN_ADMIN]: { reporterRole: 'admin', reporterName: 'Oliwer', lang: 'en' },
};

const STRINGS = {
  ru: {
    registered:    (name) => `Привет, ${name}! 👋 Бот для отчётов зарегистрирован. Напишите любое сообщение, чтобы сообщить о проблеме или пожелании.`,
    badPin:        'Неверный PIN. Попробуйте: /start <PIN>',
    notRegistered: 'Пожалуйста, зарегистрируйтесь: /start <PIN>',
    resuming:      (q) => `(продолжаем ваш сеанс)\n\n${q}`,
    continuePrompt: 'Пожалуйста, продолжите описание.',
    preview:       (summary) => `📋 Проверьте ваш отчёт:\n\n${summary}\n\nОтветьте "Отправить" для подтверждения или напишите исправление.`,
    published:     (url) => `✅ Отчёт отправлен!\n${url}`,
    publishFail:   'Не удалось отправить отчёт. Попробуйте написать "Отправить" ещё раз.',
    error:         'Что-то пошло не так. Попробуйте написать ещё раз.',
    reset:         'Сеанс сброшен. Напишите что-нибудь, чтобы начать заново.',
  },
  en: {
    registered:    (name) => `Hey, ${name}! 👋 Report bot registered. Send any message to report a bug or request a feature.`,
    badPin:        'Wrong PIN. Try: /start <PIN>',
    notRegistered: 'Please register first: /start <PIN>',
    resuming:      (q) => `(resuming your session)\n\n${q}`,
    continuePrompt: 'Please continue your description.',
    preview:       (summary) => `📋 Check your report:\n\n${summary}\n\nReply "Send" to confirm or type a correction.`,
    published:     (url) => `✅ Report submitted!\n${url}`,
    publishFail:   'Failed to submit report. Try writing "Send" again.',
    error:         'Something went wrong. Please try again.',
    reset:         'Session cleared. Send any message to start fresh.',
  },
};

async function loadChatReporters() {
  try {
    const rows = await db.select({
      telegramChatId: feedbackReports.telegramChatId,
      reporterRole:   feedbackReports.reporterRole,
      reporterName:   feedbackReports.reporterName,
    }).from(feedbackReports).where(eq(feedbackReports.githubIssueNumber, 0));
    for (const row of rows) {
      if (row.telegramChatId) {
        chatReporters.set(row.telegramChatId, { reporterRole: row.reporterRole, reporterName: row.reporterName, lang: row.reporterRole === 'admin' ? 'en' : 'ru' });
      }
    }
  } catch (err) {
    console.error('[FEEDBACK_BOT] failed to load chat reporters:', err.message);
  }
}

const CONFIRM_PHRASES = ['отправить', 'да', 'yes', 'подтвердить', 'confirm', 'ок', 'ok', 'send'];

async function handleConfirmation(token, chatId, text, sessionId, s) {
  const lower = text.toLowerCase();
  if (CONFIRM_PHRASES.some(p => lower.includes(p))) {
    try {
      const { issueUrl } = await feedbackService.publishSession(sessionId);
      chatSessions.delete(chatId);
      await send(token, chatId, s.published(issueUrl));
    } catch (err) {
      console.error('[FEEDBACK_BOT] publish error:', err.message);
      await send(token, chatId, s.publishFail);
    }
  } else {
    chatSessions.set(chatId, sessionId);
    try {
      const result = await feedbackService.continueSession(sessionId, text);
      if (result.done) {
        await showPreview(token, chatId, sessionId, s);
      } else {
        await send(token, chatId, result.question);
      }
    } catch (err) {
      console.error('[FEEDBACK_BOT] continue error:', err.message);
      await send(token, chatId, s.error);
    }
  }
}

async function showPreview(token, chatId, sessionId, s) {
  const { summary } = await feedbackService.previewSession(sessionId);
  chatSessions.set(chatId, `preview:${sessionId}`);
  await send(token, chatId, s.preview(summary));
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
  const reporter = chatReporters.get(chatId);
  if (!reporter) {
    await send(token, chatId, STRINGS.ru.notRegistered);
    return;
  }

  const s = STRINGS[reporter.lang] ?? STRINGS.ru;
  const existing = chatSessions.get(chatId);

  if (existing?.startsWith('preview:')) {
    return handleConfirmation(token, chatId, text, existing.slice(8), s);
  }

  try {
    if (!existing) {
      const activeRow = await findActiveSessionForChat(chatId);
      if (activeRow) {
        if (activeRow.done) {
          chatSessions.set(chatId, `preview:${activeRow.id}`);
          await showPreview(token, chatId, activeRow.id, s);
        } else {
          chatSessions.set(chatId, activeRow.id);
          const q = activeRow.lastQuestion || s.continuePrompt;
          await send(token, chatId, s.resuming(q));
        }
        return;
      }

      const result = await feedbackService.startSession({
        text,
        appArea: 'telegram',
        reporterRole: reporter.reporterRole,
        reporterName: reporter.reporterName,
        telegramChatId: chatId,
      });
      chatSessions.set(chatId, result.sessionId);

      if (result.done) {
        await showPreview(token, chatId, result.sessionId, s);
      } else {
        await send(token, chatId, result.question);
      }
    } else {
      const result = await feedbackService.continueSession(existing, text);
      if (result.done) {
        await showPreview(token, chatId, existing, s);
      } else {
        await send(token, chatId, result.question);
      }
    }
  } catch (err) {
    console.error('[FEEDBACK_BOT] route error:', err.message);
    await send(token, chatId, s.error);
  }
}

async function handleUpdate(token, update) {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId = String(msg.chat.id);
  const text = msg.text.trim();

  if (text === '/reset') {
    chatSessions.delete(chatId);
    try {
      await db.delete(feedbackSessions).where(
        and(eq(feedbackSessions.telegramChatId, chatId), eq(feedbackSessions.published, false))
      );
    } catch (err) {
      console.error('[FEEDBACK_BOT] reset error:', err.message);
    }
    const reporter = chatReporters.get(chatId);
    const s = STRINGS[(reporter?.lang)] ?? STRINGS.ru;
    await send(token, chatId, s.reset);
    return;
  }

  if (text.startsWith('/start')) {
    const pin = text.split(' ')[1];
    const reporter = REPORTERS[pin];
    if (reporter) {
      chatReporters.set(chatId, reporter);
      try {
        await db.insert(feedbackReports).values({
          githubIssueNumber: 0,
          reporterRole:      reporter.reporterRole,
          reporterName:      reporter.reporterName,
          telegramChatId:    chatId,
        });
      } catch (err) {
        console.error('[FEEDBACK_BOT] register error:', err.message);
      }
      const s = STRINGS[reporter.lang] ?? STRINGS.ru;
      await send(token, chatId, s.registered(reporter.reporterName));
    } else {
      await send(token, chatId, STRINGS.ru.badPin);
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
  await loadChatReporters();
  running = true;
  poll(token);
  console.log('[FEEDBACK_BOT] Feedback Telegram bot started');
}

export function stopFeedbackBot() {
  running = false;
  if (pollTimer) clearTimeout(pollTimer);
}
