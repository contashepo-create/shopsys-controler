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

export function isValidDeviceId(v: string): boolean {
  return DEVICE_RE.test(v)
}

function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  return v
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u200B\u2060\uFEFF]/g, '')
    .trim()
    .slice(0, max)
}

export function parseRegistrationRecord(raw: string | null): RegistrationRecord | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null
    const deviceId = typeof o.deviceId === 'string' ? o.deviceId.trim().toUpperCase() : ''
    if (!DEVICE_RE.test(deviceId)) return null
    // حقول نصية أساسية — نتسامح مع غيابها
    const rec: RegistrationRecord = {
      deviceId,
      shopName: typeof o.shopName === 'string' ? cleanText(o.shopName, 120) : '',
      ownerName: typeof o.ownerName === 'string' ? cleanText(o.ownerName, 120) : '',
      phone: typeof o.phone === 'string' ? cleanText(o.phone, 40) : '',
      email: typeof o.email === 'string' && /^\S+@\S+\.\S+$/.test(cleanText(o.email, 254)) ? cleanText(o.email, 254) : '',
      city: typeof o.city === 'string' ? cleanText(o.city, 80) : '',
      street: typeof o.street === 'string' ? cleanText(o.street, 160) : '',
      activityNameAr: typeof o.activityNameAr === 'string' ? cleanText(o.activityNameAr, 60) : '',
      registeredAt: typeof o.registeredAt === 'string' ? o.registeredAt : '',
      firstSeenAt: typeof o.firstSeenAt === 'string' ? o.firstSeenAt : '',
      lastSeenAt: typeof o.lastSeenAt === 'string' ? o.lastSeenAt : '',
      reports: typeof o.reports === 'number' && Number.isFinite(o.reports) ? Math.floor(o.reports) : 1,
    }
    // حقول اختيارية
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
        if (typeof v === 'string' && v) pc[k] = cleanText(v, 120)
      }
      if (Object.keys(pc).length) rec.pendingChanges = pc
      if (typeof o.pendingAt === 'string') rec.pendingAt = o.pendingAt
    }
    // تواريخ بلا قيمة — نملأها بوقت التحليل كاحتياط
    if (!rec.registeredAt) rec.registeredAt = rec.firstSeenAt || rec.lastSeenAt || new Date().toISOString()
    if (!rec.firstSeenAt) rec.firstSeenAt = rec.registeredAt
    if (!rec.lastSeenAt) rec.lastSeenAt = rec.firstSeenAt
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

/** تنسيق عنوان كامل */
export function fullAddress(r: Pick<RegistrationRecord, 'city' | 'street'>): string {
  return [r.city, r.street].filter(Boolean).join(' — ') || '—'
}

/** ترتيب حسب الأحدث أولاً */
export function sortRegistrationsByNewest(list: readonly RegistrationRecord[]): RegistrationRecord[] {
  return [...list].sort((a, b) => String(b.lastSeenAt ?? '').localeCompare(String(a.lastSeenAt ?? '')))
}

/** فلترة بالبحث: اسم المحل، المالك، الهاتف، البريد، الجهاز، النشاط */
export function filterRegistrations(list: readonly RegistrationRecord[], query: string, onlyNew?: boolean, hasLicenseFn?: (id: string) => boolean): RegistrationRecord[] {
  const q = query.trim().toLowerCase()
  return list.filter((r) => {
    if (onlyNew && hasLicenseFn?.(r.deviceId)) return false
    if (!q) return true
    return (
      r.shopName.toLowerCase().includes(q) ||
      r.ownerName.toLowerCase().includes(q) ||
      r.phone.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q) ||
      r.deviceId.toLowerCase().includes(q) ||
      r.activityNameAr.toLowerCase().includes(q) ||
      (r.activityId ?? '').toLowerCase().includes(q) ||
      r.city.toLowerCase().includes(q)
    )
  })
}
