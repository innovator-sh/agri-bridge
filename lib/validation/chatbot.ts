import { z } from 'zod';

export const MAX_CHAT_CHARS = 1000;
export const MAX_HISTORY_ITEMS = 10;

export const chatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(MAX_CHAT_CHARS),
});

export type ChatTurn = z.infer<typeof chatTurnSchema>;

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1, 'Message is required').max(MAX_CHAT_CHARS),
  // Parsed leniently on purpose: malformed or non-user/assistant entries are dropped, not rejected.
  conversationHistory: z.array(z.unknown()).optional(),
});

/** Keeps only valid user/assistant turns (never 'system'), at most the last MAX_HISTORY_ITEMS. */
export function sanitizeHistory(history: unknown[] | undefined): ChatTurn[] {
  if (!history) return [];
  const turns: ChatTurn[] = [];
  for (const item of history) {
    const parsed = chatTurnSchema.safeParse(item);
    if (parsed.success) turns.push({ role: parsed.data.role, content: parsed.data.content });
  }
  return turns.slice(-MAX_HISTORY_ITEMS);
}
