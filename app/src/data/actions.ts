/**
 * Orchestration actions — renderer-side flows that combine the bridge (KV/Telegram/
 * signing) with the pure core. Every sensitive action appends to the local audit log.
 */

import { bridge } from './bridge.ts'
import {
  expiresAfterDays, keyFingerprint, canonicalPayload,
  type LicenseFeature, type LicensePayload, type LicensePlan,
} from '../core/license.ts'
import { appendDeviceLogEntry, type CustomerView } from '../core/customers.ts'
import { appendNotice, buildNotice, resolveTargetDevices, validateNoticeBody, type NoticeTargeting } from '../core/notices.ts'
import { appendChatMessage, parseChat, validateReply } from '../core/support.ts'
import { sanitizeDetails, type AuditAction } from '../core/audit.ts'
import { describeTargeting } from '../core/notices.ts'

export interface IssueLicenseInput {
  deviceId: string
  customer: string
  plan: LicensePlan
  days: number
  activityId?: string
  extraUsers?: number
  extraBranches?: number
  features: LicenseFeature[]
  extraModules?: string[]
}

export interface IssueLicenseResult {
  key: string
  fingerprint: string
  payload: LicensePayload
}

export async function audit(action: AuditAction, target?: string, details?: Record<string, unknown>): Promise<void> {
  try {
    await bridge.db.auditAppend({ action, target, details: details ? sanitizeDetails(details) : undefined, at: new Date().toISOString() })
  } catch { /* audit must never break the flow */ }
}

/** Sign a license locally (main process holds the private key) and upload the records to KV. */
export async function issueLicense(input: IssueLicenseInput, opts: { renew?: boolean } = {}): Promise<IssueLicenseResult> {
  const payload: LicensePayload = {
    v: 1,
    deviceId: input.deviceId,
    customer: input.customer,
    plan: input.plan,
    features: input.features,
    issuedAt: new Date().toISOString().slice(0, 10),
    expiresAt: input.plan === 'lifetime' ? null : expiresAfterDays(input.days),
    ...(input.extraUsers ? { extraUsers: input.extraUsers } : {}),
    ...(input.extraBranches ? { extraBranches: input.extraBranches } : {}),
    ...(input.activityId ? { activityId: input.activityId } : {}),
    ...(input.extraModules?.length ? { extraModules: input.extraModules } : {}),
  }
  const sign = await bridge.license.sign(JSON.stringify(payload))
  if (!sign.ok || !sign.key) throw new Error(sign.error ?? 'تعذر توقيع المفتاح — تحقق من المفتاح الخاص في الإعدادات')
  const key = sign.key
  const fingerprint = keyFingerprint(key)

  const licRecord = JSON.stringify({ payload, key, issuedAt: payload.issuedAt, revoked: false })
  const r1 = await bridge.cf.put('license', `lic:${fingerprint}`, licRecord)
  if (!r1.ok) throw new Error(r1.error ?? 'تعذر الكتابة في Cloudflare')

  const devRecord = JSON.stringify({
    plan: payload.plan,
    expiresAt: payload.expiresAt,
    customer: payload.customer,
    message: '',
    fingerprint,
  })
  const r2 = await bridge.cf.put('license', `dev:${input.deviceId}`, devRecord)
  if (!r2.ok) throw new Error(r2.error ?? 'تعذر الكتابة في Cloudflare')

  // device log — same shape the devbot appends
  const logKey = `log:${input.deviceId}`
  const prevLog = await bridge.cf.get('license', logKey)
  const entryText = `${opts.renew ? 'تجديد' : 'تفعيل'} ${payload.plan} حتى ${payload.expiresAt ?? 'مدى الحياة'} — ${payload.customer}`
  await bridge.cf.put('license', logKey, appendDeviceLogEntry(prevLog.ok ? prevLog.value : null, entryText))

  // mirror the subscription card on the services namespace (the full worker's /subscription)
  await bridge.cf.put('services', `sub:${input.deviceId}`, JSON.stringify({
    plan: payload.plan, expiresAt: payload.expiresAt, message: '', customer: payload.customer, issuedAt: payload.issuedAt,
  }))

  await audit(opts.renew ? 'license_renew' : 'license_issue', input.deviceId, {
    fingerprint, plan: payload.plan, expiresAt: payload.expiresAt, customer: payload.customer,
  })
  return { key, fingerprint, payload }
}

/** Burn a license: add the fingerprint to the revocation list (both namespaces) + flag the record. */
export async function revokeLicense(fingerprintOrKey: string): Promise<{ fingerprint: string }> {
  const fingerprint = /^[0-9a-f]{8}$/.test(fingerprintOrKey) ? fingerprintOrKey : keyFingerprint(fingerprintOrKey)
  for (const ns of ['license', 'services'] as const) {
    const cur = await bridge.cf.get(ns, 'revoked')
    let list: string[] = []
    try { list = cur.ok && cur.value ? JSON.parse(cur.value) as string[] : [] } catch { list = [] }
    if (!Array.isArray(list)) list = []
    if (!list.includes(fingerprint)) {
      list.push(fingerprint)
      const r = await bridge.cf.put(ns, 'revoked', JSON.stringify(list))
      if (!r.ok) throw new Error(r.error ?? 'تعذر الكتابة في Cloudflare')
    }
  }
  const rec = await bridge.cf.get('license', `lic:${fingerprint}`)
  if (rec.ok && rec.value) {
    try {
      const o = JSON.parse(rec.value) as { revoked?: boolean }
      o.revoked = true
      await bridge.cf.put('license', `lic:${fingerprint}`, JSON.stringify(o))
      const deviceId = (o as { payload?: { deviceId?: string } }).payload?.deviceId
      if (deviceId) {
        const logKey = `log:${deviceId}`
        const prevLog = await bridge.cf.get('license', logKey)
        await bridge.cf.put('license', logKey, appendDeviceLogEntry(prevLog.ok ? prevLog.value : null, `حرق المفتاح ${fingerprint}`))
        await audit('license_revoke', deviceId, { fingerprint })
      }
    } catch { /* record unreadable — revocation list is the source of truth */ }
  }
  await audit('license_revoke', fingerprint, {})
  return { fingerprint }
}

/** Send a notification to the resolved targets. Returns the number of device lists written. */
export async function sendNotice(input: { title?: string; body: string; expiresAt?: string | null; targeting: NoticeTargeting; customers: readonly CustomerView[] }): Promise<{ targets: number; mode: 'global' | 'devices' }> {
  const bodyError = validateNoticeBody(input.body)
  if (bodyError) throw new Error(bodyError)
  const notice = buildNotice({ title: input.title, body: input.body, expiresAt: input.expiresAt ?? null })
  const resolved = resolveTargetDevices(input.targeting, input.customers)
  if (resolved.mode === 'global') {
    const cur = await bridge.cf.get('license', 'notices:global')
    const r = await bridge.cf.put('license', 'notices:global', appendNotice(cur.ok ? cur.value : null, notice))
    if (!r.ok) throw new Error(r.error ?? 'تعذر الكتابة في Cloudflare')
  } else {
    if (resolved.deviceIds.length === 0) throw new Error('لا يوجد عملاء مطابقون للاستهداف')
    for (const deviceId of resolved.deviceIds) {
      const key = `notices:${deviceId}`
      const cur = await bridge.cf.get('license', key)
      const r = await bridge.cf.put('license', key, appendNotice(cur.ok ? cur.value : null, notice))
      if (!r.ok) throw new Error(r.error ?? `تعذر الكتابة للجهاز ${deviceId}`)
    }
  }
  await audit('notice_send', resolved.mode === 'global' ? 'all' : `${resolved.deviceIds.length} device`, {
    title: notice.title,
    targeting: describeTargeting(input.targeting, input.customers),
    expiresAt: notice.expiresAt,
  })
  return { targets: resolved.mode === 'global' ? input.customers.length : resolved.deviceIds.length, mode: resolved.mode }
}

/** Reply to a support ticket (appends a developer message to chat:<deviceId>). */
export async function replySupport(deviceId: string, text: string): Promise<void> {
  const err = validateReply(text)
  if (err) throw new Error(err)
  const cur = await bridge.cf.get('services', `chat:${deviceId}`)
  const next = appendChatMessage(cur.ok ? cur.value : null, 'developer', text)
  const r = await bridge.cf.put('services', `chat:${deviceId}`, next)
  if (!r.ok) throw new Error(r.error ?? 'تعذر الكتابة في Cloudflare')
  await audit('support_reply', deviceId, { length: text.length })
}

/** Read a support conversation. */
export async function readSupportChat(deviceId: string) {
  const cur = await bridge.cf.get('services', `chat:${deviceId}`)
  if (!cur.ok) throw new Error(cur.error ?? 'تعذر القراءة من Cloudflare')
  return parseChat(cur.value)
}

/** Update the «حول» content — written to BOTH namespaces (both workers serve /about). */
export async function updateAbout(content: { title: string; body: string; supportPhone: string; supportTelegram: string; website: string }): Promise<void> {
  const value = JSON.stringify({ ...content, updatedAt: new Date().toISOString() })
  for (const ns of ['license', 'services'] as const) {
    const r = await bridge.cf.put(ns, 'about', value)
    if (!r.ok) throw new Error(r.error ?? 'تعذر الكتابة في Cloudflare')
  }
  await audit('about_update', undefined, { title: content.title })
}

/** Publish an app version (services namespace /version endpoint). */
export async function updateVersion(info: { latestVersion: string; downloadUrl: string; sha256: string; mandatory: boolean; releaseNotesAr: string }): Promise<void> {
  const value = JSON.stringify({ ...info, publishedAt: new Date().toISOString() })
  const r = await bridge.cf.put('services', 'version', value)
  if (!r.ok) throw new Error(r.error ?? 'تعذر الكتابة في Cloudflare')
  await audit('version_update', info.latestVersion, { mandatory: info.mandatory })
}

/** Global defaults for new licenses (settings:global — same shape the devbot uses). */
export async function updateGlobalSettings(settings: {
  plan: LicensePlan
  days: number
  features: LicenseFeature[]
  extraUsers: number
  extraBranches: number
  extraModules: string[]
}): Promise<void> {
  const r = await bridge.cf.put('license', 'settings:global', JSON.stringify(settings))
  if (!r.ok) throw new Error(r.error ?? 'تعذر الكتابة في Cloudflare')
  await audit('settings_global_update', undefined, { plan: settings.plan, days: settings.days })
}

/** Cloud feature flags (services namespace flags:<deviceId>) — disable/enable a granted feature temporarily. */
export async function setCloudFlag(deviceId: string, feature: LicenseFeature, disabled: boolean, noteAr?: string): Promise<void> {
  const key = `flags:${deviceId}`
  const cur = await bridge.cf.get('services', key)
  let flags: { disabledFeatures?: string[]; noteAr?: string; updatedAt?: string } = {}
  try { flags = cur.ok && cur.value ? JSON.parse(cur.value) as typeof flags : {} } catch { flags = {} }
  const set = new Set(flags.disabledFeatures ?? [])
  if (disabled) set.add(feature)
  else set.delete(feature)
  flags.disabledFeatures = [...set]
  if (noteAr !== undefined) flags.noteAr = noteAr
  if (!disabled && set.size === 0) flags.noteAr = ''
  flags.updatedAt = new Date().toISOString()
  const r = await bridge.cf.put('services', key, JSON.stringify(flags))
  if (!r.ok) throw new Error(r.error ?? 'تعذر الكتابة في Cloudflare')
  await audit(disabled ? 'flag_disable' : 'flag_enable', deviceId, { feature })
}

/** Read cloud flags for a device. */
export async function readCloudFlags(deviceId: string): Promise<{ disabledFeatures: string[]; noteAr: string }> {
  const cur = await bridge.cf.get('services', `flags:${deviceId}`)
  if (!cur.ok || !cur.value) return { disabledFeatures: [], noteAr: '' }
  try {
    const o = JSON.parse(cur.value) as { disabledFeatures?: string[]; noteAr?: string }
    return { disabledFeatures: o.disabledFeatures ?? [], noteAr: o.noteAr ?? '' }
  } catch {
    return { disabledFeatures: [], noteAr: '' }
  }
}

/** Canonical payload preview — for the UI to show exactly what will be signed. */
export function previewPayload(input: IssueLicenseInput): LicensePayload {
  return {
    v: 1,
    deviceId: input.deviceId,
    customer: input.customer,
    plan: input.plan,
    features: input.features,
    issuedAt: new Date().toISOString().slice(0, 10),
    expiresAt: input.plan === 'lifetime' ? null : expiresAfterDays(input.days),
    ...(input.extraUsers ? { extraUsers: input.extraUsers } : {}),
    ...(input.extraBranches ? { extraBranches: input.extraBranches } : {}),
    ...(input.activityId ? { activityId: input.activityId } : {}),
    ...(input.extraModules?.length ? { extraModules: input.extraModules } : {}),
  }
}

export { canonicalPayload }
