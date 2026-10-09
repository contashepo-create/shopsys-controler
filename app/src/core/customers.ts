/**
 * Customer read-model — builds the monitoring view from raw KV records.
 * KV schema (SHOPSYS_CONTROL, mirrors tools/devbot in the shopsys repo):
 *   dev:<deviceId>   → { plan, expiresAt, customer, message, fingerprint, activityId? }
 *                      (activityId = النشاط الذي اختاره العميل في التطبيق / آخر نشاط اعتمده المطوّر)
 *   lic:<fingerprint>→ { payload, key, issuedAt, revoked, note? }
 *   log:<deviceId>   → [{ at: 'YYYY-MM-DD HH:MM', text }]   (max 200, same as the bot)
 *   email:<mail>     → deviceId
 *   revoked          → ['8hex', ...]
 * Services namespace (SHOPSYS_KV):
 *   chat:<deviceId>  → [{ id, from: 'client'|'developer', text, at }] (max 200)
 */

import { daysBetween, keyFingerprint, type LicenseFeature, type LicensePayload, type LicensePlan } from './license.ts'
import { activityDisplay, activityFromDevRecord } from './activities.ts'

export type CustomerStatus = 'active' | 'expiring' | 'expired' | 'revoked' | 'none'

export const EXPIRING_WINDOW_DAYS = 7

export interface DevRecord {
  plan?: string
  expiresAt?: string | null
  customer?: string
  message?: string
  fingerprint?: string
  /** النشاط الذي اختاره العميل (أو آخر نشاط اعتمده المطوّر) — انظر activityFromDevRecord */
  activityId?: string
  [extra: string]: unknown
}

export interface LicRecord {
  payload: LicensePayload
  key: string
  issuedAt: string
  revoked?: boolean
  note?: string
}

export interface DeviceLogEntry {
  at: string
  text: string
}

export interface CustomerView {
  deviceId: string
  customer: string
  email: string | null
  plan: string
  expiresAt: string | null
  /** نشاط المفتاح الموقّع الحالي */
  activityId: string | null
  /** النشاط كما اختاره العميل (من سجل الجهاز dev:) */
  clientActivityId: string | null
  features: LicenseFeature[]
  extraUsers: number
  extraBranches: number
  extraModules: string[]
  fingerprint: string | null
  /** المفتاح الموقّع الحالي (من lic:<fingerprint>) — لإعادة نسخه أو إرساله للعميل */
  licenseKey: string | null
  /** تاريخ إصدار المفتاح الحالي */
  licenseIssuedAt: string | null
  /** آخر اتصال للتطبيق بالسحابة (dev:<deviceId>.lastSeenAt يكتبه الـ worker) */
  lastSeenAt: string | null
  status: CustomerStatus
  lastActivityAt: string | null
  lastSupportAt: string | null
  /** آخر رسالة في محادثة الدعم من العميل (لم يُرد عليها بعد) */
  supportUnread: boolean
  message: string
}

/** جهاز له محادثة دعم بلا سجل dev: (لم يُفعَّل بعد) — يظهر في صفحة الدعم رغم ذلك */
export interface ChatOnlyDevice {
  deviceId: string
  lastSupportAt: string | null
  supportUnread: boolean
}

/**
 * ملخص محادثة chat:<deviceId> الخام: عدد الرسائل الصالحة، وقت آخر رسالة، وهل آخرها من العميل.
 * يتسامح مع عناصر بشكل غير متوقع (يتخطاها) ولا يرمي أبداً.
 */
export function parseChatSummary(raw: string | null): { count: number; lastAt: string | null; unread: boolean } {
  if (!raw) return { count: 0, lastAt: null, unread: false }
  let arr: unknown
  try { arr = JSON.parse(raw) } catch { return { count: 0, lastAt: null, unread: false } }
  if (!Array.isArray(arr)) return { count: 0, lastAt: null, unread: false }
  const msgs = arr.filter((m): m is { from: string; at?: unknown } =>
    m != null && typeof m === 'object' && ((m as { from?: unknown }).from === 'client' || (m as { from?: unknown }).from === 'developer'))
  const last = msgs[msgs.length - 1]
  return {
    count: msgs.length,
    lastAt: last && typeof last.at === 'string' ? last.at : null,
    unread: last?.from === 'client',
  }
}

export function parseDevRecord(raw: string | null): DevRecord {
  if (!raw) return {}
  try {
    const o = JSON.parse(raw)
    // مصفوفة «كائن» في JS — كانت تُقبل سجلاً للجهاز
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {}
    const rec = o as DevRecord
    // حقول نصية بنوع خاطئ تُسقط بدل أن تُعطّل التصفية (toLowerCase) أو البحث عن البصمة
    for (const f of ['plan', 'customer', 'message', 'fingerprint', 'activityId'] as const) {
      if (rec[f] != null && typeof rec[f] !== 'string') delete rec[f]
    }
    if (rec.expiresAt != null && typeof rec.expiresAt !== 'string') delete rec.expiresAt
    return rec
  } catch {
    return {}
  }
}

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const nonNegInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined

/**
 * الحمولة كما خُزّنت مع تنقية الأنواع: features/extraModules مصفوفات نصوص، الإضافات أرقام،
 * customer نص. سجل تالف (مثلاً features نص) كان يُسقط الصفحة عند ‎.map‎ أو ‎.toLowerCase‎.
 */
function sanitizePayload(p: unknown): LicensePayload | null {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null
  const o = p as Record<string, unknown>
  if (typeof o.plan !== 'string' || !o.plan) return null
  const out: LicensePayload = {
    ...(o as unknown as LicensePayload),
    customer: typeof o.customer === 'string' ? o.customer : '',
    plan: o.plan as LicensePlan,
    features: strArr(o.features) as LicenseFeature[],
    issuedAt: typeof o.issuedAt === 'string' ? o.issuedAt : '',
    expiresAt: typeof o.expiresAt === 'string' ? o.expiresAt : null,
  }
  const eu = nonNegInt(o.extraUsers)
  const eb = nonNegInt(o.extraBranches)
  if (eu === undefined) delete out.extraUsers; else out.extraUsers = eu
  if (eb === undefined) delete out.extraBranches; else out.extraBranches = eb
  if (o.extraModules === undefined) delete out.extraModules; else out.extraModules = strArr(o.extraModules)
  if (o.activityId != null && typeof o.activityId !== 'string') delete out.activityId
  return out
}

export function parseLicRecord(raw: string | null): LicRecord | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.key !== 'string' || !o.key) return null
    const payload = sanitizePayload(o.payload)
    if (!payload) return null
    return { ...(o as LicRecord), payload, issuedAt: typeof o.issuedAt === 'string' ? o.issuedAt : '' }
  } catch {
    return null
  }
}

export function parseDeviceLog(raw: string | null): DeviceLogEntry[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((e) => e && typeof e.at === 'string' && typeof e.text === 'string') : []
  } catch {
    return []
  }
}

export function computeStatus(args: {
  plan?: string
  expiresAt?: string | null
  revokedFingerprint?: boolean
  todayIso: string
}): CustomerStatus {
  if (args.revokedFingerprint) return 'revoked'
  if (!args.plan) return 'none'
  if (args.expiresAt == null) return 'active' // lifetime
  const days = daysBetween(args.todayIso, args.expiresAt)
  // تاريخ غير مفهوم: لا نعرضه «نشطاً» (NaN كان يفلت من كل المقارنات) — يُعامل كمنتهٍ ليلفت النظر
  if (!Number.isFinite(days)) return 'expired'
  if (days < 0) return 'expired'
  if (days <= EXPIRING_WINDOW_DAYS) return 'expiring'
  return 'active'
}

/**
 * سجل dev:<deviceId> الجديد بعد الإصدار — يُدمج مع السجل الحالي بدل استبداله، حتى لا يضيع
 * ما كتبه تطبيق العميل/الـ worker (مثل النشاط المختار و lastSeenAt)، ويُكتب النشاط المعتمد
 * (لو حُدد) ليظهر تلقائياً في الإصدار القادم. يُزال disabledAt لأن الإصدار تنشيط.
 */
export function mergeDevRecord(raw: string | null, next: { plan: string; expiresAt: string | null; customer: string; fingerprint: string; activityId?: string }): string {
  const prev = parseDevRecord(raw)
  const merged: Record<string, unknown> = { ...prev, plan: next.plan, expiresAt: next.expiresAt, customer: next.customer, message: '', fingerprint: next.fingerprint }
  if (next.activityId) merged.activityId = next.activityId
  delete merged.disabledAt
  return JSON.stringify(merged)
}

/** Append an entry to a device log — same shape the devbot writes (max 200). */
export function appendDeviceLogEntry(raw: string | null, text: string, nowIso = new Date().toISOString()): string {
  const log = parseDeviceLog(raw)
  const at = nowIso.slice(0, 16).replace('T', ' ')
  log.push({ at, text })
  return JSON.stringify(log.slice(-200))
}

export interface BuildViewsInput {
  /** [deviceId, raw] pairs from keys with prefix dev: */
  devEntries: readonly (readonly [string, string | null])[]
  /** [fingerprint, raw] pairs from keys with prefix lic: */
  licEntries: readonly (readonly [string, string | null])[]
  /** [deviceId, raw] pairs from keys with prefix log: */
  logEntries: readonly (readonly [string, string | null])[]
  /** [email, deviceId] pairs from keys with prefix email: (values are the deviceId) */
  emailEntries: readonly (readonly [string, string | null])[]
  /** [deviceId, raw] pairs from keys with prefix chat: (services namespace) */
  chatEntries: readonly (readonly [string, string | null])[]
  revoked: readonly string[]
  todayIso: string
}

export function buildCustomerViews(input: BuildViewsInput): CustomerView[] {
  const revokedSet = new Set(input.revoked)
  const licByFingerprint = new Map<string, LicRecord>()
  for (const [fp, raw] of input.licEntries) {
    const rec = parseLicRecord(raw)
    if (rec) licByFingerprint.set(fp, rec)
  }
  const emailByDevice = new Map<string, string>()
  for (const [mail, deviceId] of input.emailEntries) {
    if (deviceId) emailByDevice.set(deviceId, mail)
  }
  const logByDevice = new Map<string, DeviceLogEntry[]>()
  for (const [deviceId, raw] of input.logEntries) {
    const log = parseDeviceLog(raw)
    if (log.length) logByDevice.set(deviceId, log)
  }
  const chatByDevice = new Map<string, string | null>()
  for (const [deviceId, raw] of input.chatEntries) {
    if (raw) chatByDevice.set(deviceId, raw)
  }

  const views: CustomerView[] = []
  for (const [deviceId, raw] of input.devEntries) {
    const dev = parseDevRecord(raw)
    const lic = dev.fingerprint ? licByFingerprint.get(dev.fingerprint) ?? null : null
    const payload: LicensePayload | null = lic?.payload ?? null
    const fingerprint = dev.fingerprint ?? (lic ? keyFingerprint(lic.key) : null)
    const revokedFingerprint = fingerprint != null && (revokedSet.has(fingerprint) || lic?.revoked === true)
    // السجل الموقّع هو الحقيقة الملزِمة عند العميل؛ نسقط إلى dev: عند غياب سجل المفتاح
    const plan = (payload?.plan ?? dev.plan ?? '') as string
    const expiresAt = payload ? payload.expiresAt : (dev.expiresAt ?? null)
    const log = logByDevice.get(deviceId)
    const chat = parseChatSummary(chatByDevice.get(deviceId) ?? null)
    views.push({
      deviceId,
      customer: payload?.customer ?? dev.customer ?? '',
      email: emailByDevice.get(deviceId) ?? null,
      plan,
      expiresAt: expiresAt ?? null,
      activityId: payload?.activityId ?? null,
      clientActivityId: activityFromDevRecord(dev),
      features: payload?.features ?? [],
      extraUsers: payload?.extraUsers ?? 0,
      extraBranches: payload?.extraBranches ?? 0,
      extraModules: payload?.extraModules ?? [],
      fingerprint,
      licenseKey: lic?.key ?? null,
      licenseIssuedAt: lic?.issuedAt ?? payload?.issuedAt ?? null,
      lastSeenAt: typeof dev.lastSeenAt === 'string' ? dev.lastSeenAt : null,
      status: computeStatus({ plan, expiresAt: expiresAt ?? null, revokedFingerprint, todayIso: input.todayIso }),
      lastActivityAt: log?.length ? log[log.length - 1].at : null,
      lastSupportAt: chat.lastAt,
      supportUnread: chat.unread,
      message: dev.message ?? '',
    })
  }
  return views
}

export const STATUS_LABELS_AR: Record<CustomerStatus, string> = {
  active: 'نشط',
  expiring: 'قرب الانتهاء',
  expired: 'منتهٍ',
  revoked: 'محروق',
  none: 'بدون اشتراك',
}

export type CustomerSortKey = 'customer' | 'expiresAt' | 'lastActivityAt' | 'status'

/** ترتيب الحالة بالأهمية (يحتاج تدخلاً أولاً) — وليس أبجدياً بالأسماء الإنجليزية */
export const STATUS_RANK: Record<CustomerStatus, number> = { expiring: 0, expired: 1, revoked: 2, active: 3, none: 4 }

/**
 * الترتيب: الحالة بالأهمية؛ الانتهاء بالتاريخ والدائم (null) في الآخر تصاعدياً؛ وأي قيمة فارغة
 * (بلا نشاط) تذهب للآخر في الاتجاهين. التعادل يُحسم باسم العميل ثم المعرّف ليثبت الترتيب.
 */
export function sortCustomers(list: readonly CustomerView[], key: CustomerSortKey, direction: 'asc' | 'desc' = 'asc'): CustomerView[] {
  const dir = direction === 'asc' ? 1 : -1
  const tie = (a: CustomerView, b: CustomerView) =>
    a.customer.localeCompare(b.customer, 'ar') || a.deviceId.localeCompare(b.deviceId)
  return [...list].sort((a, b) => {
    if (key === 'status') return (STATUS_RANK[a.status] - STATUS_RANK[b.status]) * dir || tie(a, b)
    if (key === 'customer') return (a.customer.localeCompare(b.customer, 'ar') || a.deviceId.localeCompare(b.deviceId)) * dir
    const va = a[key]
    const vb = b[key]
    // expiresAt: null = دائم ⇒ «أبعد» تاريخ (آخر تصاعدياً، أول تنازلياً)؛ lastActivityAt: null = بلا نشاط ⇒ آخراً دائماً
    if (va == null || vb == null) {
      if (va == null && vb == null) return tie(a, b)
      if (key === 'expiresAt') return (va == null ? 1 : -1) * dir
      return va == null ? 1 : -1
    }
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir || tie(a, b)
  })
}

export function filterCustomers(list: readonly CustomerView[], query: string, status?: CustomerStatus | 'all'): CustomerView[] {
  const q = query.trim().toLowerCase()
  return list.filter((c) => {
    if (status && status !== 'all' && c.status !== status) return false
    if (!q) return true
    return (
      c.customer.toLowerCase().includes(q)
      || c.deviceId.toLowerCase().includes(q)
      || (c.email ?? '').toLowerCase().includes(q)
      || (c.activityId ?? '').toLowerCase().includes(q)
      || (c.clientActivityId ?? '').toLowerCase().includes(q)
      || activityDisplay(c.clientActivityId ?? c.activityId).toLowerCase().includes(q)
    )
  })
}

export function isValidPlan(plan: string): plan is LicensePlan {
  return plan === 'trial' || plan === 'basic' || plan === 'pro' || plan === 'lifetime'
}

/**
 * قائمة «يحتاج تجديداً» في اللوحة الرئيسية: القريب من الانتهاء أولاً (الأقرب فالأبعد)،
 * ثم المنتهي (الأحدث انتهاءً أولاً — الأرجح أنه سيجدد). كان الترتيب ترتيب التحميل فيضيع
 * من ينتهي غداً خلف من انتهى قبل سنة.
 */
export function expiringFirst(customers: readonly CustomerView[], limit: number): CustomerView[] {
  const exp = (c: CustomerView) => c.expiresAt ?? ''
  const expiring = customers.filter((c) => c.status === 'expiring').sort((a, b) => exp(a).localeCompare(exp(b)))
  const expired = customers.filter((c) => c.status === 'expired').sort((a, b) => exp(b).localeCompare(exp(a)))
  return [...expiring, ...expired].slice(0, limit)
}
