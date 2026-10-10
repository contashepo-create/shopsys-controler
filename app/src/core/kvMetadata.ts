/**
 * metadata مفاتيح KV التي يقرؤها البوت وcloud worker بلا قراءة كل سجل (مطابقة حرفياً):
 *  • dev:<deviceId>  → deviceMetadata  (tools/devbot/src/subscriptions.js — فهرس التذكير اليومي)
 *  • chat:<deviceId> → chatMetadata    (cloud/worker.js — صندوق وارد الدعم)
 * ⚠️ كتابة KV بلا metadata تُسقط الفهرس: البوت يعود إلى قراءة السجل بحد 40 قراءة في كل دورة،
 * فتُتخطى الأجهزة بصمت، وصندوق الدعم يفقد المحادثات غير المقروءة.
 */

export const DEVICE_META_VERSION = 1
export const CHAT_META_VERSION = 1

export type DeviceMetadata = {
  v: number
  expiresAt: string | null
  customer: string
  plan: string
  email: string
}

export function deviceMetadata(record: unknown): DeviceMetadata {
  const r = (record && typeof record === 'object' ? record : null) as Record<string, unknown> | null
  const str = (v: unknown, max: number) => String(v ?? '').slice(0, max)
  return {
    v: DEVICE_META_VERSION,
    expiresAt: r && r.expiresAt ? str(r.expiresAt, 20) : null,
    customer: str(r?.customer, 120),
    plan: str(r?.plan, 20),
    email: str(r?.email, 128),
  }
}

/** تنظيف النص كما في cloud/worker.js (clean). */
function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  return v
    // محارف التحكم مقصودة هنا: نزعها هو الهدف
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u200B\u2060\uFEFF]/g, '')
    .trim()
    .slice(0, max)
}

export type ChatMetadata = {
  v: number
  count: number
  lastFrom: string
  lastAt: string
  lastText: string
}

export function chatMetadata(chat: readonly unknown[]): ChatMetadata {
  const last = (chat.length ? chat[chat.length - 1] : {}) as Record<string, unknown>
  return {
    v: CHAT_META_VERSION,
    count: chat.length,
    lastFrom: String(last.from ?? '').slice(0, 12),
    lastAt: String(last.at ?? '').slice(0, 30),
    lastText: cleanText(last.text, 120),
  }
}
