// Data-access for assistant_conversations — Ask Blossom chat history.
// The row id IS the assistant sessionId. `messages` is the canonical Anthropic
// message array; projection to display turns happens in assistantService.
import { eq, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { assistantConversations } from '../db/schema.js';

// Insert a new conversation or, on id conflict, refresh its messages + bump
// updated_at. Title is written only on insert so a later rename is preserved.
export async function upsert({ id, title, messages }) {
  await db
    .insert(assistantConversations)
    .values({ id, title: title ?? '', messages })
    .onConflictDoUpdate({
      target: assistantConversations.id,
      set: { messages, updatedAt: sql`now()` },
    });
}

// Newest-first list for the history rail. messageCount lets the UI show size
// without shipping every message.
export async function list() {
  return db
    .select({
      id: assistantConversations.id,
      title: assistantConversations.title,
      updatedAt: assistantConversations.updatedAt,
      messageCount: sql`jsonb_array_length(${assistantConversations.messages})`.mapWith(Number),
    })
    .from(assistantConversations)
    .orderBy(desc(assistantConversations.updatedAt));
}

export async function getById(id) {
  const [row] = await db
    .select()
    .from(assistantConversations)
    .where(eq(assistantConversations.id, id));
  return row ?? null;
}

export async function rename(id, title) {
  const [row] = await db
    .update(assistantConversations)
    .set({ title, updatedAt: sql`now()` })
    .where(eq(assistantConversations.id, id))
    .returning({ id: assistantConversations.id, title: assistantConversations.title });
  return row ?? null;
}

export async function remove(id) {
  const rows = await db
    .delete(assistantConversations)
    .where(eq(assistantConversations.id, id))
    .returning({ id: assistantConversations.id });
  return rows.length > 0;
}
