/**
 * Password hashing — PBKDF2-SHA256 via WebCrypto (runs in renderer, main, and Node tests).
 * Only the hash+salt ever leave this module; the plain password never persists.
 */

export interface PasswordHash {
  /** base64 salt */
  salt: string
  /** base64 derived key */
  hash: string
  iterations: number
}

export const PBKDF2_ITERATIONS = 210_000
export const SALT_BYTES = 16
export const KEY_BYTES = 32

const te = new TextEncoder()

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function generateSalt(): string {
  const salt = new Uint8Array(SALT_BYTES)
  crypto.getRandomValues(salt)
  return toBase64(salt)
}

export async function hashPassword(password: string, saltB64?: string): Promise<PasswordHash> {
  const salt = saltB64 ?? generateSalt()
  const baseKey = await crypto.subtle.importKey('raw', te.encode(password) as unknown as BufferSource, 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt) as unknown as BufferSource, iterations: PBKDF2_ITERATIONS },
    baseKey,
    KEY_BYTES * 8,
  )
  return { salt, hash: toBase64(new Uint8Array(bits)), iterations: PBKDF2_ITERATIONS }
}

/** Constant-time comparison. */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const candidate = await hashPassword(password, stored.salt)
  if (candidate.iterations !== stored.iterations) return false
  const a = fromBase64(candidate.hash)
  const b = fromBase64(stored.hash)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return 'كلمة المرور قصيرة — 8 أحرف على الأقل'
  if (password.length > 128) return 'كلمة المرور طويلة جداً'
  return null
}
