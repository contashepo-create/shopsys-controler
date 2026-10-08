/**
 * Support channel (developer ↔ customer) — mirrors the full worker's KV format:
 *   chat:<deviceId> → [{ id, from: 'client'|'developer', text, at }]  (max 200, CHAT_KEEP)
 * The panel reads tickets and appends developer replies in the exact same shape,
 * so the customer app sees them on its next poll of /support/:deviceId.
 */

export type ChatFrom = 'client' | 'developer'

export interface ChatMessage {
  id: number
  from: ChatFrom
  text: string
  at: string
}

export const CHAT_KEEP = 200
export const SUPPORT_TEXT_MAX = 4000

/** Same cleaning the worker applies to incoming customer text. */
export function cleanSupportText(text: string, max = SUPPORT_TEXT_MAX): string {
  return String(text)
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max)
}

export function parseChat(raw: string | null): ChatMessage[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((m) => m && typeof m.id === 'number' && (m.from === 'client' || m.from === 'developer') && typeof m.text === 'string') as ChatMessage[]
  } catch {
    return []
  }
}

/**
 * Append a message — the panel assigns the id itself (the worker does max+1
 * when IT pushes; direct KV writes must do the same) and keeps the last 200.
 */
export function appendChatMessage(raw: string | null, from: ChatFrom, text: string, nowIso = new Date().toISOString()): string {
  const chat = parseChat(raw)
  const id = chat.length ? Math.max(...chat.map((m) => m.id || 0)) + 1 : 1
  chat.push({ id, from, text: cleanSupportText(text), at: nowIso })
  const trimmed = chat.length > CHAT_KEEP ? chat.slice(chat.length - CHAT_KEEP) : chat
  return JSON.stringify(trimmed)
}

export function lastMessageAt(chat: readonly ChatMessage[]): string | null {
  return chat.length ? chat[chat.length - 1].at : null
}

/** A ticket is "unread" when the last message came from the customer. */
export function hasUnreadFromClient(chat: readonly ChatMessage[]): boolean {
  return chat.length > 0 && chat[chat.length - 1].from === 'client'
}

export function validateReply(text: string): string | null {
  if (cleanSupportText(text).length < 3) return 'الرد قصير جداً'
  return null
}
