/**
 * Developer → customers notifications.
 * KV schema (SHOPSYS_CONTROL, mirrors the devbot):
 *   notices:global     → CloudNotice[]  (every customer)
 *   notices:<deviceId> → CloudNotice[]  (one customer / group / activity)
 * The client merges both lists (see getNotificationsForDevice in the devbot).
 */

import type { CustomerView } from './customers.ts'

export interface CloudNotice {
  id: string
  title: string
  body: string
  createdAt: string
  expiresAt: string | null
}

export const NOTICE_DEFAULT_TTL_DAYS = 90
export const NOTICE_MAX_PER_LIST = 50
export const NOTICE_MAX_BODY = 1500

export function buildNotice(input: { title?: string; body: string; expiresAt?: string | null }, now = new Date()): CloudNotice {
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + NOTICE_DEFAULT_TTL_DAYS * 86400000).toISOString()
  return {
    id: crypto.randomUUID(),
    title: (input.title ?? '').trim() || 'رسالة من المطوّر',
    body: input.body,
    createdAt: now.toISOString(),
    expiresAt,
  }
}

export function parseNoticeList(raw: string | null): CloudNotice[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((n) => n && typeof n.id === 'string' && typeof n.body === 'string') as CloudNotice[]
  } catch {
    return []
  }
}

/**
 * Append a notice to a KV list — mirrors the devbot's appendNotice:
 * drop expired, push, keep the last 50.
 */
export function appendNotice(raw: string | null, notice: CloudNotice, now = new Date()): string {
  const previous = parseNoticeList(raw).filter((n) => n?.expiresAt && Date.parse(n.expiresAt) > now.getTime())
  previous.push(notice)
  return JSON.stringify(previous.slice(-NOTICE_MAX_PER_LIST))
}

export type NoticeTargeting =
  | { type: 'all' }
  | { type: 'device'; deviceId: string }
  | { type: 'group'; deviceIds: string[] }
  | { type: 'activity'; activityId: string }

/** نشاط العميل الفعلي للاستهداف: اختياره في التطبيق ثم نشاط مفتاحه. */
export function customerActivity(c: { activityId?: string | null; clientActivityId?: string | null }): string | null {
  return c.clientActivityId ?? c.activityId ?? null
}

export type ResolvedTargets = { mode: 'global' } | { mode: 'devices'; deviceIds: string[] }

/** Resolve the composer targeting into concrete device IDs (or the global list). */
export function resolveTargetDevices(targeting: NoticeTargeting, customers: readonly CustomerView[]): ResolvedTargets {
  switch (targeting.type) {
    case 'all':
      return { mode: 'global' }
    case 'device':
      return { mode: 'devices', deviceIds: [targeting.deviceId] }
    case 'group':
      return { mode: 'devices', deviceIds: [...new Set(targeting.deviceIds)] }
    case 'activity': {
      const ids = customers.filter((c) => customerActivity(c) === targeting.activityId).map((c) => c.deviceId)
      return { mode: 'devices', deviceIds: ids }
    }
  }
}

export function validateNoticeBody(body: string): string | null {
  if (body.trim().length < 3) return 'نص الإشعار قصير جداً'
  if (body.length > NOTICE_MAX_BODY) return `نص الإشعار طويل — الحد ${NOTICE_MAX_BODY} حرف`
  return null
}

export function describeTargeting(targeting: NoticeTargeting, customers: readonly CustomerView[]): string {
  switch (targeting.type) {
    case 'all':
      return 'جميع العملاء'
    case 'device':
      return `عميل واحد (${targeting.deviceId})`
    case 'group':
      return `مجموعة (${targeting.deviceIds.length} عميل)`
    case 'activity': {
      const count = customers.filter((c) => customerActivity(c) === targeting.activityId).length
      return `نشاط «${targeting.activityId}» (${count} عميل)`
    }
  }
}

/* ─── سجل الإشعارات المرسلة: تعديل / حذف / تتبع القراءة ─── */

export const NOTICE_KEY_PREFIX = 'notices:'
export const NOTICE_GLOBAL_KEY = 'notices:global'
/**
 * إيصالات القراءة — يكتبها الـ worker عندما يبلّغ التطبيق أن العميل فتح الإشعار:
 *   noticeread:<deviceId> → { "<noticeId>": "<ISO وقت القراءة>", ... }
 * (العقد موثّق في docs/تتبع-قراءة-الإشعارات.md)
 */
export const NOTICE_READ_PREFIX = 'noticeread:'

export interface SentNotice {
  notice: CloudNotice & { editedAt?: string }
  scope: 'global' | 'devices'
  /** الأجهزة المستهدفة (فارغة للعام = كل العملاء) */
  deviceIds: string[]
  /** مفاتيح KV التي يوجد فيها الإشعار — يُعدَّل/يُحذف منها كلها */
  listKeys: string[]
}

/** يجمع كل قوائم notices:* في سجل واحد — إشعار المجموعة/النشاط الواحد يظهر مرة واحدة بكل أجهزته. */
export function collectSentNotices(lists: readonly (readonly [string, string | null])[]): SentNotice[] {
  const byId = new Map<string, SentNotice>()
  for (const [key, raw] of lists) {
    if (!key.startsWith(NOTICE_KEY_PREFIX)) continue
    const isGlobal = key === NOTICE_GLOBAL_KEY
    const deviceId = isGlobal ? null : key.slice(NOTICE_KEY_PREFIX.length)
    for (const n of parseNoticeList(raw)) {
      let entry = byId.get(n.id)
      if (!entry) {
        entry = { notice: n, scope: isGlobal ? 'global' : 'devices', deviceIds: [], listKeys: [] }
        byId.set(n.id, entry)
      }
      if (isGlobal) entry.scope = 'global'
      if (deviceId && !entry.deviceIds.includes(deviceId)) entry.deviceIds.push(deviceId)
      if (!entry.listKeys.includes(key)) entry.listKeys.push(key)
    }
  }
  return [...byId.values()].sort((a, b) => b.notice.createdAt.localeCompare(a.notice.createdAt))
}

export interface NoticePatch {
  title?: string
  body?: string
  expiresAt?: string | null
}

/** يعدّل إشعاراً داخل قائمة (نفس المعرّف، فيبقى عند العميل نفس الإشعار بنص جديد). */
export function editNoticeInList(raw: string | null, id: string, patch: NoticePatch, now = new Date()): { raw: string; changed: boolean } {
  const list = parseNoticeList(raw) as (CloudNotice & { editedAt?: string })[]
  let changed = false
  const next = list.map((n) => {
    if (n.id !== id) return n
    changed = true
    return {
      ...n,
      ...(patch.title !== undefined ? { title: patch.title.trim() || 'رسالة من المطوّر' } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
      editedAt: now.toISOString(),
    }
  })
  return { raw: JSON.stringify(next), changed }
}

/** يحذف إشعاراً من قائمة. */
export function removeNoticeFromList(raw: string | null, id: string): { raw: string; changed: boolean } {
  const list = parseNoticeList(raw)
  const next = list.filter((n) => n.id !== id)
  return { raw: JSON.stringify(next), changed: next.length !== list.length }
}

/** noticeread:<deviceId> → خريطة معرّف الإشعار ← وقت القراءة (يقبل أيضاً مصفوفة معرّفات أو [{id, at}]). */
export function parseNoticeReads(raw: string | null): Record<string, string> {
  if (!raw) return {}
  try {
    const o = JSON.parse(raw) as unknown
    const out: Record<string, string> = {}
    if (Array.isArray(o)) {
      for (const item of o) {
        if (typeof item === 'string') out[item] = ''
        else if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
          const at = (item as { at?: unknown }).at
          out[(item as { id: string }).id] = typeof at === 'string' ? at : ''
        }
      }
      return out
    }
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) out[k] = typeof v === 'string' ? v : ''
    }
    return out
  } catch {
    return {}
  }
}

export type NoticeReadState = 'read' | 'delivered' | 'pending'

export interface NoticeRecipient {
  deviceId: string
  customer: string
  state: NoticeReadState
  /** وقت القراءة أو آخر ظهور */
  at: string | null
}

export const READ_STATE_LABELS_AR: Record<NoticeReadState, string> = {
  read: 'قرأه',
  delivered: 'وصله (فتح التطبيق بعد الإرسال)',
  pending: 'لم يصله بعد',
}

/**
 * حالة كل مستلم:
 *  • قرأه   — يوجد إيصال قراءة في noticeread:<deviceId>
 *  • وصله   — اتصل تطبيقه بالسحابة بعد إرسال الإشعار (lastSeenAt) ولا إيصال قراءة
 *  • لم يصله — لم يتصل منذ الإرسال
 */
export function noticeRecipients(
  sent: SentNotice,
  customers: readonly Pick<CustomerView, 'deviceId' | 'customer' | 'lastSeenAt'>[],
  readsByDevice: ReadonlyMap<string, Record<string, string>>,
): NoticeRecipient[] {
  const byId = new Map(customers.map((c) => [c.deviceId, c]))
  const ids = sent.scope === 'global' ? customers.map((c) => c.deviceId) : sent.deviceIds
  const since = Date.parse(sent.notice.createdAt)
  return ids.map((deviceId) => {
    const c = byId.get(deviceId)
    const reads = readsByDevice.get(deviceId)
    if (reads && sent.notice.id in reads) return { deviceId, customer: c?.customer ?? '', state: 'read' as const, at: reads[sent.notice.id] || null }
    const seen = c?.lastSeenAt ?? null
    if (seen && Date.parse(seen) >= since) return { deviceId, customer: c?.customer ?? '', state: 'delivered' as const, at: seen }
    return { deviceId, customer: c?.customer ?? '', state: 'pending' as const, at: seen }
  })
}

export function summarizeRecipients(list: readonly NoticeRecipient[]): Record<NoticeReadState, number> & { total: number } {
  const out = { read: 0, delivered: 0, pending: 0, total: list.length }
  for (const r of list) out[r.state]++
  return out
}
