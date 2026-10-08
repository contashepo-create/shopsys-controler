/**
 * الترخيص — نسخة «مركز تحكم المطور» منقولة حرفياً من
 * shopsys/app/src/core/license.ts + shopsys/tools/devbot/src/licenseLib.js
 * ─────────────────────────────────────────────────────────────
 * أي فرق في ترتيب الحقول أو الترميز يكسر التوقيع عند العميل.
 * اختبار التوافق الذهبي (tests/license_compat.test.ts) يحمي العقد،
 * ويؤكده سكربت verify_license_core.mjs.
 */

/**
 * المفتاح العام للمطوّر (base64url — 32 بايت raw) — مطابق لتطبيق العميل.
 * لا تغيّره أبداً بعد issue أي مفتاح.
 */
export const DEVELOPER_PUBLIC_KEY_B64U = 'mOugSh8oJdc5H6nB9mMTNQYjyXzYle2RJepQkob3msE'

export type LicensePlan = 'trial' | 'basic' | 'pro' | 'lifetime'

/** ميزات تُفعَّل بمفتاح الترخيص فقط */
export type LicenseFeature =
  | 'einvoice_eg'
  | 'einvoice_sa'
  | 'multi_branch'
  | 'telegram_bot'
  | 'cloud_sync'
  | 'multi_user_lan'

export const LICENSE_FEATURES: readonly LicenseFeature[] = [
  'einvoice_eg',
  'einvoice_sa',
  'multi_branch',
  'telegram_bot',
  'cloud_sync',
  'multi_user_lan',
]

export const FEATURE_LABELS_AR: Record<LicenseFeature, string> = {
  einvoice_eg: 'الفاتورة الإلكترونية المصرية',
  einvoice_sa: 'الفاتورة الإلكترونية السعودية',
  multi_branch: 'تعدد الفروع',
  telegram_bot: 'بوت تليجرام',
  cloud_sync: 'المزامنة السحابية',
  multi_user_lan: 'تعدد المستخدمين على الشبكة',
}

/** الوحدات الـ17 القابلة للمنح بمفتاح موقّع (extraModules — عقد إضافة قسم خارج النشاط) */
export const EXTRA_MODULES: readonly string[] = [
  'pos', 'inventory', 'purchases', 'installments', 'recipes', 'processing', 'jewelry',
  'maintenance', 'laundry', 'booking', 'equipment_rental', 'logistics', 'lab',
  'contracting', 'clinic', 'cars', 'wallet_services', 'realestate',
]

export const MODULE_LABELS_AR: Record<string, string> = {
  pos: 'نقطة البيع', inventory: 'المخزون', purchases: 'المشتريات', installments: 'الأقساط',
  recipes: 'الوصفات', processing: 'التصنيع', jewelry: 'الذهب والمجوهرات', maintenance: 'الصيانة',
  laundry: 'المغسلة', booking: 'الحجوزات', equipment_rental: 'تأجير المعدات', logistics: 'اللوجستيات',
  lab: 'المختبر', contracting: 'المقاولات', clinic: 'العيادة', cars: 'السيارات',
  wallet_services: 'الخدمات المالية', realestate: 'العقارات',
}

export interface LicensePayload {
  v: 1
  deviceId: string
  customer: string
  plan: LicensePlan
  features: LicenseFeature[]
  issuedAt: string
  expiresAt: string | null
  extraUsers?: number
  extraBranches?: number
  activityId?: string
  extraModules?: string[]
}

export interface PlanLimits {
  maxUsers: number
  maxBranches: number
  multiInstance: boolean
}

export const PLAN_LIMITS: Record<LicensePlan, PlanLimits> = {
  trial: { maxUsers: 1, maxBranches: 1, multiInstance: false },
  basic: { maxUsers: 1, maxBranches: 1, multiInstance: false },
  pro: { maxUsers: 5, maxBranches: 2, multiInstance: true },
  lifetime: { maxUsers: 10, maxBranches: 3, multiInstance: true },
}

export const PLAN_LABELS_AR: Record<LicensePlan, string> = {
  trial: 'تجريبي',
  basic: 'أساسي',
  pro: 'احترافي',
  lifetime: 'مدى الحياة',
}

export function effectiveLimits(payload: LicensePayload | null): PlanLimits {
  const base = PLAN_LIMITS[payload?.plan ?? 'trial']
  return {
    maxUsers: base.maxUsers + Math.max(0, payload?.extraUsers ?? 0),
    maxBranches: base.maxBranches + Math.max(0, payload?.extraBranches ?? 0),
    multiInstance: base.multiInstance,
  }
}

export const TRIAL_DAYS = 14
export const KEY_PREFIX = 'SHOPSYS1'
export const ACTIVITY_KEY_PREFIX = 'SHOPSYS2'

/** معرّف الجهاز: SHOP-XXXX-XXXX-XXXX */
export const DEVICE_ID_RE = /^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/

/* ─── base64url بلا حشوة — ترميز يدوي بدون btoa/atob (يعمل في المتصفح وNode وElectron) ─── */

const B64U_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function b64uEncode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    out += B64U_CHARS[b0 >> 2]
    out += B64U_CHARS[((b0 & 3) << 4) | (b1 >> 4)]
    if (i + 1 < bytes.length) out += B64U_CHARS[((b1 & 15) << 2) | (b2 >> 6)]
    if (i + 2 < bytes.length) out += B64U_CHARS[b2 & 63]
  }
  return out
}

export function b64uDecode(s: string): Uint8Array {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/')
  const b64 = clean + '='.repeat((4 - (clean.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * ترتيب حتمي للحقول قبل التوقيع — نفس ترتيب license.ts بالضبط:
 * الحقلان الاختياريان (extraUsers/extraBranches) يدخلان الصيغة فقط عند وجودهما،
 * كما هو الحال مع activityId وextraModules.
 */
export function canonicalPayload(p: LicensePayload): string {
  const base: Record<string, unknown> = {
    v: p.v, deviceId: p.deviceId, customer: p.customer, plan: p.plan,
    features: [...p.features].sort(), issuedAt: p.issuedAt, expiresAt: p.expiresAt,
  }
  if (p.extraUsers != null) base.extraUsers = p.extraUsers
  if (p.extraBranches != null) base.extraBranches = p.extraBranches
  if (p.activityId != null) base.activityId = p.activityId
  if (p.extraModules != null) base.extraModules = [...p.extraModules].sort()
  return JSON.stringify(base)
}

export interface ActivityChangePayload {
  v: 1
  deviceId: string
  fromActivityId: string
  toActivityId: string
  issuedAt: string
}

export function canonicalActivityChangePayload(p: ActivityChangePayload): string {
  return JSON.stringify({ v: p.v, deviceId: p.deviceId, fromActivityId: p.fromActivityId, toActivityId: p.toActivityId, issuedAt: p.issuedAt })
}

/**
 * بصمة المفتاح للحرق/الإبطال — djb2 على جزء التوقيع (مطابق keyFingerprint):
 * 8 خانات hex صغيرة، وهي الصيغة الوحيدة التي تقبلها parseRevocationList بالعميل.
 */
export function keyFingerprint(key: string): string {
  const sigPart = key.trim().split('.')[2] ?? key
  let h = 5381
  for (let i = 0; i < sigPart.length; i++) h = ((h << 5) + h + sigPart.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

export function isRevoked(key: string, revokedFingerprints: readonly string[]): boolean {
  return revokedFingerprints.includes(keyFingerprint(key))
}

/** توليد معرّف جهاز ثابت المظهر: SHOP-XXXX-XXXX-XXXX */
export function generateDeviceId(randomBytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // بلا حروف ملتبسة
  let s = ''
  for (let i = 0; i < 12; i++) s += alphabet[randomBytes[i] % alphabet.length]
  return `SHOP-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`
}

/** بنية مفتاح التفعيل: SHOPSYS1.<payload-b64u>.<sig-b64u> */
export function encodeLicenseKey(payload: LicensePayload, signature: Uint8Array): string {
  const body = b64uEncode(new TextEncoder().encode(canonicalPayload(payload)))
  return `${KEY_PREFIX}.${body}.${b64uEncode(signature)}`
}

export function decodeLicenseKey(key: string): { payload: LicensePayload; body: string; sig: Uint8Array } {
  const parts = key.trim().split('.')
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) throw new Error('صيغة مفتاح التفعيل غير صحيحة')
  let payload: LicensePayload
  try {
    payload = JSON.parse(new TextDecoder().decode(b64uDecode(parts[1]))) as LicensePayload
  } catch {
    throw new Error('محتوى المفتاح تالف')
  }
  if (payload.v !== 1 || !payload.deviceId || !payload.plan) throw new Error('محتوى المفتاح ناقص')
  return { payload, body: parts[1], sig: b64uDecode(parts[2]) }
}

/* ─── توقيع وتحقق (WebCrypto Ed25519 — متاح في المتصفح وElectron وNode 18+) ─── */

export async function importPrivateKey(privB64u: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', b64uDecode(privB64u) as unknown as ArrayBuffer, 'Ed25519', false, ['sign'])
}

export async function importPublicKey(pubB64u: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64uDecode(pubB64u) as unknown as ArrayBuffer, 'Ed25519', true, ['verify'])
}

/** إصدار مفتاح تفعيل موقّع: SHOPSYS1.<payload-b64u>.<sig-b64u> (مطابق encodeLicenseKey) */
export async function issueLicenseKey(payload: LicensePayload, privB64u: string): Promise<string> {
  const priv = await importPrivateKey(privB64u)
  const msg = new TextEncoder().encode(canonicalPayload(payload))
  const sig = await crypto.subtle.sign('Ed25519', priv, msg)
  return encodeLicenseKey(payload, new Uint8Array(sig))
}

/** إصدار مفتاح تغيير نشاط موقّع: SHOPSYS2.<payload-b64u>.<sig-b64u> */
export async function issueActivityChangeKey(payload: ActivityChangePayload, privB64u: string): Promise<string> {
  const priv = await importPrivateKey(privB64u)
  const msg = new TextEncoder().encode(canonicalActivityChangePayload(payload))
  const sig = await crypto.subtle.sign('Ed25519', priv, msg)
  return `${ACTIVITY_KEY_PREFIX}.${b64uEncode(msg)}.${b64uEncode(new Uint8Array(sig))}`
}

/** تحقق كامل من مفتاح: توقيع صحيح + الجهاز مطابق. يعيد الحمولة أو يرمي */
export async function verifyLicenseKey(
  key: string,
  deviceId: string,
  pubB64u: string = DEVELOPER_PUBLIC_KEY_B64U,
): Promise<LicensePayload> {
  const { payload, sig } = decodeLicenseKey(key)
  const pub = await importPublicKey(pubB64u)
  const msg = new TextEncoder().encode(canonicalPayload(payload))
  const ok = await crypto.subtle.verify('Ed25519', pub, sig as unknown as ArrayBuffer, msg as unknown as ArrayBuffer)
  if (!ok) throw new Error('التوقيع غير صحيح — المفتاح ليس صادراً من المطوّر')
  if (payload.deviceId !== deviceId) throw new Error(`المفتاح صادر لجهاز آخر (${payload.deviceId})`)
  return payload
}

/** تاريخ انتهاء ISO (YYYY-MM-DD) بعد عدد الأيام — null = مدى الحياة */
export function expiresAfterDays(days: number | null | undefined, todayIso = new Date().toISOString().slice(0, 10)): string | null {
  if (days == null || days <= 0) return null
  const d = new Date(todayIso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86400000)
}
