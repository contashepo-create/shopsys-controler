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
      const ids = customers.filter((c) => c.activityId === targeting.activityId).map((c) => c.deviceId)
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
      const count = customers.filter((c) => c.activityId === targeting.activityId).length
      return `نشاط «${targeting.activityId}» (${count} عميل)`
    }
  }
}
