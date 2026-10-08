/**
 * OTP codes for sensitive flows (password change / reset).
 * The code is sent to the developer's Telegram chat (trusted channel — the bot
 * only ever talks to TELEGRAM_ADMIN_ID). Only a SHA-256 hash is kept locally.
 */

export const OTP_TTL_MS = 5 * 60 * 1000
export const OTP_MAX_ATTEMPTS = 3
export const OTP_LENGTH = 6

export interface PendingOtp {
  /** sha-256 hex of the code */
  hash: string
  expiresAt: number
  attempts: number
}

export function generateOtpCode(): string {
  const bytes = new Uint8Array(OTP_LENGTH)
  crypto.getRandomValues(bytes)
  let code = ''
  for (let i = 0; i < OTP_LENGTH; i++) code += String(bytes[i] % 10)
  return code
}

export async function hashOtp(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.trim()))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function createPendingOtp(hash: string, now = Date.now()): PendingOtp {
  return { hash, expiresAt: now + OTP_TTL_MS, attempts: 0 }
}

export function isOtpExpired(otp: PendingOtp, now = Date.now()): boolean {
  return now > otp.expiresAt
}

/** Verify a user-entered code; mutates attempts. Returns 'ok' | 'wrong' | 'expired' | 'locked'. */
export async function checkOtp(otp: PendingOtp, code: string, now = Date.now()): Promise<'ok' | 'wrong' | 'expired' | 'locked'> {
  if (isOtpExpired(otp, now)) return 'expired'
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return 'locked'
  otp.attempts += 1
  const hash = await hashOtp(code)
  return hash === otp.hash ? 'ok' : 'wrong'
}

/** The message sent to the developer's Telegram chat. */
export function buildOtpMessage(appName: string, code: string, purposeAr: string): string {
  return [
    `🔐 ${appName}`,
    `رمز التحقق لـ${purposeAr}:`,
    '',
    code,
    '',
    `صالح لمدة ${Math.round(OTP_TTL_MS / 60000)} دقائق — لا تشاركه مع anyone.`,
  ].join('\n')
}
