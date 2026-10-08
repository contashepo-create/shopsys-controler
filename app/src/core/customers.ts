/**
 * Customer read-model — builds the monitoring view from raw KV records.
 * KV schema (SHOPSYS_CONTROL, mirrors tools/devbot in the shopsys repo):
 *   dev:<deviceId>   → { plan, expiresAt, customer, message, fingerprint }
 *   lic:<fingerprint>→ { payload, key, issuedAt, revoked, note? }
 *   log:<deviceId>   → [{ at: 'YYYY-MM-DD HH:MM', text }]   (max 200, same as the bot)
 *   email:<mail>     → deviceId
 *   revoked          → ['8hex', ...]
 * Services namespace (SHOPSYS_KV):
 *   chat:<deviceId>  → [{ id, from: 'client'|'developer', text, at }] (max 200)
 */

import { daysBetween, keyFingerprint, type LicenseFeature, type LicensePayload, type LicensePlan } from './license.ts'

export type CustomerStatus = 'active' | 'expiring' | 'expired' | 'revoked' | 'none'

export const EXPIRING_WINDOW_DAYS = 7

export interface DevRecord {
  plan?: string
  expiresAt?: string | null
  customer?: string
  message?: string
  fingerprint?: string
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
  activityId: string | null
  features: LicenseFeature[]
  extraUsers: number
  extraBranches: number
  extraModules: string[]
  fingerprint: string | null
  status: CustomerStatus
  lastActivityAt: string | null
  lastSupportAt: string | null
  message: string
}

export function parseDevRecord(raw: string | null): DevRecord {
  if (!raw) return {}
  try {
    const o = JSON.parse(raw)
    return o && typeof o === 'object' ? o as DevRecord : {}
  } catch {
    return {}
  }
}

export function parseLicRecord(raw: string | null): LicRecord | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object' || !o.payload || !o.key) return null
    return o as LicRecord
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
  if (days < 0) return 'expired'
  if (days <= EXPIRING_WINDOW_DAYS) return 'expiring'
  return 'active'
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
    const chatRaw = chatByDevice.get(deviceId)
    let lastSupportAt: string | null = null
    if (chatRaw) {
      try {
        const chat = JSON.parse(chatRaw) as { at?: string }[]
        if (Array.isArray(chat) && chat.length && typeof chat[chat.length - 1]?.at === 'string') {
          lastSupportAt = chat[chat.length - 1].at as string
        }
      } catch { /* ignore */ }
    }
    views.push({
      deviceId,
      customer: payload?.customer ?? dev.customer ?? '',
      email: emailByDevice.get(deviceId) ?? null,
      plan,
      expiresAt: expiresAt ?? null,
      activityId: payload?.activityId ?? null,
      features: payload?.features ?? [],
      extraUsers: payload?.extraUsers ?? 0,
      extraBranches: payload?.extraBranches ?? 0,
      extraModules: payload?.extraModules ?? [],
      fingerprint,
      status: computeStatus({ plan, expiresAt: expiresAt ?? null, revokedFingerprint, todayIso: input.todayIso }),
      lastActivityAt: log?.length ? log[log.length - 1].at : null,
      lastSupportAt,
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

export function sortCustomers(list: readonly CustomerView[], key: CustomerSortKey, direction: 'asc' | 'desc' = 'asc'): CustomerView[] {
  const dir = direction === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    const va = a[key] ?? ''
    const vb = b[key] ?? ''
    return String(va).localeCompare(String(vb), 'ar') * dir
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
    )
  })
}

export function isValidPlan(plan: string): plan is LicensePlan {
  return plan === 'trial' || plan === 'basic' || plan === 'pro' || plan === 'lifetime'
}
