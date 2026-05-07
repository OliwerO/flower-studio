import * as feedbackService from './feedbackService.js';
import { db } from '../db/index.js';
import { feedbackReports } from '../db/schema.js';

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
      await send(token, chatId, 'Не удалось отправить отчёт. Попробуйте ещё раз.');
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
      chatSessions.delete(chatId);
      await send(token, chatId, 'Что-то пошло не так. Напишите снова.');
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

async function routeMessage(token, chatId, text) {
  const existing = chatSessions.get(chatId);

  if (existing?.startsWith('preview:')) {
    return handleConfirmation(token, chatId, text, existing.slice(8));
  }

  try {
    if (!existing) {
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
    chatSessions.delete(chatId);
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

let running = false;
let pollOffset = 0;
let pollTimer = null;

async function poll(token) {
  if (!running) return;
  try {
    const res = await fetch(`${BASE}${token}/getUpdates?offset=${pollOffset}&timeout=20`);
    if (res.ok) {
      const { result: updates } = await res.json();
      for (const update of (updates || [])) {
        pollOffset = update.update_id + 1;
        await handleUpdate(token, update);
      }
    }
  } catch (err) {
    console.error('[FEEDBACK_BOT] poll error:', err.message);
  }
  if (running) pollTimer = setTimeout(() => poll(token), 500);
}

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
