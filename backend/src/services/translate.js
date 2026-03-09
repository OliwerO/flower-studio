// Translation service — auto-translates text to Russian using Claude Haiku.
// Like having a multilingual assistant at the receiving desk: orders arrive in
// any language (PL/EN/UK/TR) and get translated to Russian for the florists.
//
// Design decisions:
// - Never blocks order creation — translation failures are logged, not thrown
// - If text is already Russian, Haiku returns it unchanged (no wasted tokens)
// - Uses the smallest/cheapest model (Haiku) since this is a simple translation task

import Anthropic from '@anthropic-ai/sdk';
import * as db from './airtable.js';
import { TABLES } from '../config/airtable.js';

let client = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn('[TRANSLATE] ANTHROPIC_API_KEY not set — translation disabled');
      return null;
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * Translate text to Russian using Claude Haiku.
 * Returns the translation, or the original text if translation fails.
 * @param {string} text — the text to translate
 * @returns {Promise<string>} — translated text
 */
export async function translateToRussian(text) {
  if (!text || !text.trim()) return text;

  const anthropic = getClient();
  if (!anthropic) return text; // API key not configured — pass through

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: 'Translate the following text to Russian. If the text is already in Russian, return it unchanged. Return ONLY the translation, nothing else.',
      messages: [{ role: 'user', content: text }],
    });

    const translated = response.content?.[0]?.text?.trim();
    if (!translated) {
      console.warn('[TRANSLATE] Empty response from Haiku, returning original');
      return text;
    }

    console.log(`[TRANSLATE] "${text.slice(0, 50)}..." → "${translated.slice(0, 50)}..."`);
    return translated;
  } catch (err) {
    console.error('[TRANSLATE] Failed:', err.message);
    return text; // Never block on translation failure
  }
}

/**
 * Translate order notes asynchronously and save to Airtable.
 * Called after order creation — fire-and-forget pattern.
 * @param {string} orderId — Airtable record ID
 * @param {string} notesOriginal — the original notes text
 */
export async function translateOrderNotes(orderId, notesOriginal) {
  if (!notesOriginal || !notesOriginal.trim()) return;

  try {
    const translated = await translateToRussian(notesOriginal);
    await db.update(TABLES.ORDERS, orderId, {
      'Notes Translated': translated,
    });
    console.log(`[TRANSLATE] Order ${orderId} notes translated`);
  } catch (err) {
    // Log but don't throw — translation should never block the order flow
    console.error(`[TRANSLATE] Failed to save translation for order ${orderId}:`, err.message);
  }
}
