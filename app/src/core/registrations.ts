/**
 * بلاغات التسجيل الجديدة — مطابق لمنطق devbot/registrations.js
 * KV: reg:<deviceId> → RegistrationRecord JSON (مع metadata للفهرس)
 * dev:<deviceId> بلا خطة = «سجّل ولم يُرخّص بعد» يظهر في اللوحة كـ status=none
 */

export interface RegistrationRecord {
  deviceId: string
  shopName: string
  ownerName: string
  phone: string
  email: string
  city: string
  street: string
  activityNameAr: string
  activityId?: string
  plan?: string
  accountingMode?: string
  doctorSpecialty?: string
  countryCode?: string
  platform?: string
  appVersion?: string
  registeredAt: string
  firstSeenAt: string
  lastSeenAt: string
  reports: number
  fiscalYearName?: string
  fiscalYearStart?: string
  fiscalYearEnd?: string
  pendingChanges?: Record<string, string>
  pendingAt?: string
}

export const REG_PREFIX = 'reg:'
export const REG_MAX_BYTES = 8192

const DEVICE_RE = /^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
const UNSAFE_OBJ_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function isValidDeviceId(v: string): boolean {
  return DEVICE_RE.test(v)
}

/** تحويل الأرقام العربية المشرقية والفارسية (٠-٩ / ۰-۹) إلى أرقام لاتينية (0-9) */
export function normalizeDigits(v: string): string {
  return v
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
}

function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  return v
    .replace(/[\r\n\t]+/g, ' ')
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u200B\u2060\uFEFF]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max)
}

/**
 * تحليل سجل التسجيل بأمان.
 * @param expectedDeviceId إن مُرّر من مفتاح KV (`reg:<id>`)، يُشترط تطابقه لمنع انتحال جهاز آخر.
 */
export function parseRegistrationRecord(raw: string | null, expectedDeviceId?: string): RegistrationRecord | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null

    const bodyId = typeof o.deviceId === 'string' ? o.deviceId.trim().toUpperCase() : ''
    const keyId = typeof expectedDeviceId === 'string' ? expectedDeviceId.trim().toUpperCase() : ''
    if (keyId && !DEVICE_RE.test(keyId)) return null
    if (keyId && bodyId && bodyId !== keyId) return null
    const deviceId = keyId || bodyId
    if (!DEVICE_RE.test(deviceId)) return null

    const cleanedEmail = typeof o.email === 'string' ? cleanText(o.email, 254) : ''
    const rec: RegistrationRecord = {
      deviceId,
      shopName: typeof o.shopName === 'string' ? cleanText(o.shopName, 120) : '',
      ownerName: typeof o.ownerName === 'string' ? cleanText(o.ownerName, 120) : '',
      phone: typeof o.phone === 'string' ? cleanText(o.phone, 40) : '',
      email: /^\S+@\S+\.\S+$/.test(cleanedEmail) ? cleanedEmail : '',
      city: typeof o.city === 'string' ? cleanText(o.city, 80) : '',
      street: typeof o.street === 'string' ? cleanText(o.street, 160) : '',
      activityNameAr: typeof o.activityNameAr === 'string' ? cleanText(o.activityNameAr, 60) : '',
      registeredAt: typeof o.registeredAt === 'string' ? cleanText(o.registeredAt, 40) : '',
      firstSeenAt: typeof o.firstSeenAt === 'string' ? cleanText(o.firstSeenAt, 40) : '',
      lastSeenAt: typeof o.lastSeenAt === 'string' ? cleanText(o.lastSeenAt, 40) : '',
      reports: typeof o.reports === 'number' && Number.isFinite(o.reports) ? Math.max(1, Math.floor(o.reports)) : 1,
    }
    if (typeof o.activityId === 'string') rec.activityId = cleanText(o.activityId, 40) || undefined
    if (typeof o.plan === 'string') rec.plan = cleanText(o.plan, 12) || undefined
    if (typeof o.accountingMode === 'string') rec.accountingMode = cleanText(o.accountingMode, 10) || undefined
    if (typeof o.doctorSpecialty === 'string') rec.doctorSpecialty = cleanText(o.doctorSpecialty, 60) || undefined
    if (typeof o.countryCode === 'string') rec.countryCode = cleanText(o.countryCode, 4).toUpperCase() || undefined
    if (typeof o.platform === 'string') rec.platform = cleanText(o.platform, 16) || undefined
    if (typeof o.appVersion === 'string') rec.appVersion = cleanText(o.appVersion, 20) || undefined
    if (typeof o.fiscalYearName === 'string') rec.fiscalYearName = cleanText(o.fiscalYearName, 40) || undefined
    if (typeof o.fiscalYearStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.fiscalYearStart.trim())) rec.fiscalYearStart = o.fiscalYearStart.trim()
    if (typeof o.fiscalYearEnd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.fiscalYearEnd.trim())) rec.fiscalYearEnd = o.fiscalYearEnd.trim()
    if (o.pendingChanges && typeof o.pendingChanges === 'object' && !Array.isArray(o.pendingChanges)) {
      const pc: Record<string, string> = {}
      for (const [k, v] of Object.entries(o.pendingChanges as Record<string, unknown>)) {
        const safeKey = cleanText(k, 40)
        if (!safeKey || UNSAFE_OBJ_KEYS.has(safeKey) || typeof v !== 'string') continue
        const safeVal = cleanText(v, 120)
        if (safeVal) pc[safeKey] = safeVal
      }
      if (Object.keys(pc).length) {
        rec.pendingChanges = pc
        if (typeof o.pendingAt === 'string') rec.pendingAt = cleanText(o.pendingAt, 40) || undefined
      }
    }
    // توحيد التواريخ المتاحة فقط دون اختلاق تاريخ حالي للسجلات القديمة الفارغة
    if (!rec.registeredAt) rec.registeredAt = rec.firstSeenAt || rec.lastSeenAt
    if (!rec.firstSeenAt) rec.firstSeenAt = rec.registeredAt || rec.lastSeenAt
    if (!rec.lastSeenAt) rec.lastSeenAt = rec.firstSeenAt || rec.registeredAt
    return rec
  } catch {
    return null
  }
}

/** هل سجل الجهاز يحمل رخصة صادرة؟ نفس منطق devbot */
export function hasLicense(devRecord: Record<string, unknown> | null | undefined): boolean {
  if (!devRecord || typeof devRecord !== 'object') return false
  return Boolean(String((devRecord as { plan?: unknown }).plan ?? '').trim())
}

/** نص عربي مختصر للمنصة */
export function platformLabelAr(p?: string): string {
  if (p === 'web') return 'المتصفح'
  if (p === 'desktop') return 'سطح المكتب'
  return '—'
}

/** تسمية العرض للحقل المعلق */
export const PENDING_LABELS: Record<string, string> = {
  shopName: 'المنشأة',
  ownerName: 'المالك',
  phone: 'الهاتف',
  email: 'البريد',
  city: 'المدينة',
  street: 'الشارع',
  countryCode: 'الدولة',
  activityId: 'النشاط',
  activityNameAr: 'اسم النشاط',
  accountingMode: 'المحاسبة',
  plan: 'الخطة',
  doctorSpecialty: 'التخصص',
}

/** استرجاع التسمية العربية بأمان دون السقوط في خصائص Object.prototype (مثل toString) */
export function pendingLabelAr(key: string): string {
  return Object.hasOwn(PENDING_LABELS, key) ? PENDING_LABELS[key] : key
}

/** تنسيق عنوان كامل */
export function fullAddress(r: Pick<RegistrationRecord, 'city' | 'street'>): string {
  return [r.city, r.street].filter(Boolean).join(' — ') || '—'
}

const DIAL_BY_COUNTRY: Record<string, string> = {
  EG: '20', SA: '966', AE: '971', KW: '965', QA: '974', BH: '973', OM: '968',
  JO: '962', IQ: '964', LB: '961', SY: '963', PS: '970', YE: '967', LY: '218',
  TN: '216', DZ: '213', MA: '212', SD: '249',
}

/** رابط واتساب آمن (https://) متوافق مع سياسة أمان نوافذ Electron ويدعم الأرقام العربية */
export function whatsappUrl(phone: string | undefined, countryCode?: string): string | null {
  if (!phone) return null
  const normalized = normalizeDigits(phone).trim()
  let digits = normalized.replace(/\D/g, '')
  if (!digits) return null
  if (normalized.startsWith('+')) {
    // دولي صريح مثل +201012345678
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2)
  } else if (digits.startsWith('0')) {
    const cc = (countryCode ?? '').trim().toUpperCase()
    const dial = DIAL_BY_COUNTRY[cc] ?? (digits.length === 11 && /^01[0125]\d{8}$/.test(digits) ? '20' : '')
    if (dial) digits = dial + digits.slice(1)
  }
  if (digits.length < 8 || digits.length > 15) return null
  return `https://wa.me/${digits}`
}

/** ترتيب حسب الأحدث أولاً */
export function sortRegistrationsByNewest(list: readonly RegistrationRecord[]): RegistrationRecord[] {
  return [...list].sort((a, b) => String(b.lastSeenAt ?? '').localeCompare(String(a.lastSeenAt ?? '')))
}

/** فلترة بالبحث: اسم المحل، المالك، الهاتف (عربي/إنجليزي)، البريد، الجهاز، النشاط */
export function filterRegistrations(list: readonly RegistrationRecord[], query: string, onlyNew?: boolean, hasLicenseFn?: (id: string) => boolean): RegistrationRecord[] {
  const q = normalizeDigits(query).trim().toLowerCase()
  return list.filter((r) => {
    if (onlyNew && hasLicenseFn?.(r.deviceId)) return false
    if (!q) return true
    return (
      r.shopName.toLowerCase().includes(q) ||
      r.ownerName.toLowerCase().includes(q) ||
      normalizeDigits(r.phone).toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q) ||
      r.deviceId.toLowerCase().includes(q) ||
      r.activityNameAr.toLowerCase().includes(q) ||
      (r.activityId ?? '').toLowerCase().includes(q) ||
      r.city.toLowerCase().includes(q)
    )
  })
}
