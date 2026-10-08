/**
 * Telegram Bot API helpers (developer bot) — token validation, masking, messages.
 * Actual HTTP calls happen in the Electron main process (token stays out of the renderer).
 */

/** BotFather token format: digits:30+ chars */
export function isValidBotToken(token: string): boolean {
  return /^\d{6,12}:[A-Za-z0-9_-]{30,64}$/.test(token.trim())
}

/** Chat id: positive number (private) or -100… (group/channel) */
export function isValidChatId(chatId: string): boolean {
  return /^-?\d{4,20}$/.test(chatId.trim())
}

/** Mask a token for display: 1234567890:AAxx…xxZZ */
export function maskToken(token: string): string {
  const t = token.trim()
  if (t.length < 16) return t ? '•'.repeat(t.length) : ''
  const colon = t.indexOf(':')
  const head = colon > 0 ? t.slice(0, colon + 3) : t.slice(0, 6)
  return `${head}…${t.slice(-4)}`
}

export function apiUrl(token: string, method: string): string {
  return `https://api.telegram.org/bot${token.trim()}/${method}`
}

export function buildTestMessage(appName: string): string {
  return `✅ ${appName} — الاتصال بالبوت يعمل`
}

export function buildOtpSendError(detail: string): string {
  if (detail.includes('chat not found')) return 'المحادثة غير موجودة — أرسل /start للبوت أولاً'
  if (detail.includes('Unauthorized') || detail.includes('401')) return 'التوكن مرفوض — تأكد منه في BotFather'
  return `تعذر إرسال الرسالة: ${detail}`
}
