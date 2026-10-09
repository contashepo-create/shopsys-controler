/**
 * Orchestration actions — renderer-side flows that combine the bridge (KV/Telegram/
 * signing) with the pure core. Every sensitive action appends to the local audit log.
 */

import { bridge } from './bridge.ts'
import {
  expiresAfterDays, keyFingerprint, canonicalPayload,
  type LicenseFeature, type LicensePayload, type LicensePlan,
} from '../core/license.ts'
import { appendDeviceLogEntry, buildCustomerViews, mergeDevRecord, type CustomerView } from '../core/customers.ts'
import {
  appendNotice, buildNotice, resolveTargetDevices, validateNoticeBody, collectSentNotices, editNoticeInList,
  removeNoticeFromList, parseNoticeReads, NOTICE_KEY_PREFIX, NOTICE_READ_PREFIX,
  type NoticeTargeting, type NoticePatch, type SentNotice,
} from '../core/notices.ts'
import { finalModules, parseGlobalDefaults, type GlobalDefaults } from '../core/issueForm.ts'
import { appendChatMessage, parseChat, validateReply } from '../core/support.ts'
import { sanitizeDetails, type AuditAction } from '../core/audit.ts'
import { describeTargeting } from '../core/notices.ts'
import { mapLimit } from '../core/concurrency.ts'

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
  /** ملاحظات غير حاجبة — مثل غياب مساحة الخدمات عند تحديث بطاقة الاشتراك */
  notes?: string[]
}

/**
 * قراءة قبل تعديل: فشل القراءة (مثل 429 من Cloudflare) يوقف العملية — بدل اعتبار المفتاح فارغاً
 * ثم الكتابة فوق بيانات حقيقية لم نقرأها (قائمة الحرق، سجل الجهاز، الإشعارات، المحادثة…).
 */
export async function readForUpdate(ns: 'license' | 'services', key: string): Promise<string | null> {
  const r = await bridge.cf.get(ns, key)
  if (!r.ok) {
    const err = new Error(`تعذر قراءة «${key}» من Cloudflare فلم يُكتب شيء حتى لا تضيع بياناته — أعد المحاولة بعد قليل${r.error ? ` (${r.error})` : ''}`) as Error & { code?: string }
    err.code = r.code
    throw err
  }
  return r.value
}

export async function audit(action: AuditAction, target?: string, details?: Record<string, unknown>): Promise<void> {
  try {
    await bridge.db.auditAppend({ action, target, details: details ? sanitizeDetails(details) : undefined, at: new Date().toISOString() })
  } catch { /* audit must never break the flow */ }
}

/** Sign a license locally (main process holds the private key) and upload the records to KV. */
export async function issueLicense(input: IssueLicenseInput, opts: { renew?: boolean; burnFingerprint?: string | null } = {}): Promise<IssueLicenseResult> {
  const payload = buildPayload(input)
  const notes: string[] = []
  // نقرأ سجل الجهاز قبل أي توقيع/كتابة: لو تعذرت القراءة لا نكتب سجلاً ناقصاً فوق بيانات التطبيق
  const prevDevRaw = await readForUpdate('license', `dev:${input.deviceId}`)
  const signed = await signAvoidingRevoked(payload, notes)
  const key = signed.key
  const fingerprint = keyFingerprint(key)
  Object.assign(payload, signed.payload)

  const licRecord = JSON.stringify({ payload, key, issuedAt: payload.issuedAt, revoked: false })
  const r1 = await bridge.cf.put('license', `lic:${fingerprint}`, licRecord)
  if (!r1.ok) throw new Error(r1.error ?? 'تعذر الكتابة في Cloudflare')

  // دمج لا استبدال: يحفظ نشاط العميل المختار وما يكتبه الـ worker، ويعتمد النشاط الجديد
  const devRecord = mergeDevRecord(prevDevRaw, {
    plan: payload.plan,
    expiresAt: payload.expiresAt,
    customer: payload.customer,
    fingerprint,
    activityId: payload.activityId,
  })
  const r2 = await bridge.cf.put('license', `dev:${input.deviceId}`, devRecord)
  if (!r2.ok) throw new Error(r2.error ?? 'تعذر الكتابة في Cloudflare')

  // device log — same shape the devbot appends
  const entryText = `${opts.renew ? 'تجديد' : 'تفعيل'} ${payload.plan} حتى ${payload.expiresAt ?? 'مدى الحياة'} — ${payload.customer}${payload.activityId ? ` — نشاط: ${payload.activityId}` : ''}`
  if (!await appendLog(input.deviceId, entryText)) notes.push('صدر المفتاح لكن تعذر تسجيله في سجل الجهاز')

  // بطاقة الاشتراك في مساحة الخدمات (يقرأها worker التطبيق من /subscription)
  // أفضل جهد: غياب مساحة الخدمات لا يجوز أن يُلغي مفتاحاً صدر فعلاً في مساحة التراخيص
  const subMirror = await bridge.cf.put('services', `sub:${input.deviceId}`, JSON.stringify({
    plan: payload.plan, expiresAt: payload.expiresAt, message: '', customer: payload.customer, issuedAt: payload.issuedAt,
    // المفتاح نفسه مربوط بالجهاز (لا يعمل على غيره) — متاح للتطبيق ليطبّقه تلقائياً عند المزامنة
    key, fingerprint,
  }))
  if (!subMirror.ok) {
    notes.push(subMirror.code === 'ns_missing' ? 'لم تُحدَّث بطاقة الاشتراك السحابية: مساحة الخدمات غير مضبوطة' : `لم تُحدَّث بطاقة الاشتراك: ${subMirror.error ?? ''}`)
  }

  // حرق المفتاح السابق (اختياري) — بعد نجاح الإصدار فقط، وليس نفس البصمة الجديدة
  if (opts.burnFingerprint && opts.burnFingerprint !== fingerprint) {
    try { await revokeLicense(opts.burnFingerprint) } catch (e) {
      notes.push(`صدر المفتاح الجديد لكن تعذر حرق القديم: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  await audit(opts.renew ? 'license_renew' : 'license_issue', input.deviceId, {
    fingerprint, plan: payload.plan, expiresAt: payload.expiresAt, customer: payload.customer, activityId: payload.activityId ?? null, notes,
  })
  return { key, fingerprint, payload, notes }
}

async function readRevokedSet(): Promise<Set<string>> {
  const out = new Set<string>()
  for (const ns of ['license', 'services'] as const) {
    let raw: string | null
    try {
      raw = await readForUpdate(ns, 'revoked')
    } catch (e) {
      // مساحة خدمات غير مضبوطة = لا قائمة فيها؛ أي فشل آخر يوقف الإصدار (لا نخاطر بمفتاح مولود محروقاً)
      if (ns === 'services' && (e as { code?: string }).code === 'ns_missing') continue
      throw e
    }
    try {
      const list = raw ? JSON.parse(raw) as unknown : []
      if (Array.isArray(list)) for (const fp of list) if (typeof fp === 'string') out.add(fp)
    } catch { /* قائمة تالفة = لا شيء محروق فيها */ }
  }
  return out
}

/**
 * التوقيع مع تجنّب «المفتاح المولود محروقاً»: Ed25519 حتمي — نفس الحمولة تعطي نفس المفتاح
 * ونفس البصمة. فلو أُعيد تنشيط عميل معطّل بنفس البيانات في نفس يوم إصدار مفتاحه المحروق،
 * لخرج نفس المفتاح المحروق. عندها نغيّر الحمولة تغييراً لا يضر العميل ونعيد التوقيع:
 *   • اشتراك بتاريخ → تمديد يوم واحد
 *   • مدى الحياة → إضافة حقل اختياري بقيمة صفر (نفس الحدود تماماً، حمولة مختلفة)
 */
async function signAvoidingRevoked(base: LicensePayload, notes: string[]): Promise<{ key: string; payload: LicensePayload }> {
  const signOnce = async (p: LicensePayload) => {
    const sign = await bridge.license.sign(JSON.stringify(p))
    if (!sign.ok || !sign.key) throw new Error(sign.error ?? 'تعذر توقيع المفتاح — تحقق من المفتاح الخاص في الإعدادات')
    return sign.key
  }
  let payload = base
  let key = await signOnce(payload)
  const revoked = await readRevokedSet()
  if (!revoked.has(keyFingerprint(key))) return { key, payload }

  const variants: LicensePayload[] = []
  if (base.expiresAt) {
    for (let extra = 1; extra <= 7; extra++) {
      const d = new Date(base.expiresAt + 'T00:00:00Z')
      d.setUTCDate(d.getUTCDate() + extra)
      variants.push({ ...base, expiresAt: d.toISOString().slice(0, 10) })
    }
  } else {
    if (base.extraUsers == null) variants.push({ ...base, extraUsers: 0 })
    if (base.extraBranches == null) variants.push({ ...base, extraBranches: 0 })
    if (base.extraUsers == null && base.extraBranches == null) variants.push({ ...base, extraUsers: 0, extraBranches: 0 })
  }
  for (const v of variants) {
    payload = v
    key = await signOnce(payload)
    if (!revoked.has(keyFingerprint(key))) {
      notes.push(payload.expiresAt !== base.expiresAt
        ? `البيانات مطابقة لمفتاح محروق سابق (نفس اليوم) — مُدّد الاشتراك حتى ${payload.expiresAt} ليصدر مفتاح جديد غير محروق`
        : 'البيانات مطابقة لمفتاح محروق سابق — صدر مفتاح مختلف بنفس الحدود تماماً')
      return { key, payload }
    }
  }
  throw new Error('كل صيغ المفتاح لهذه البيانات محروقة — غيّر المدة أو الباقة ثم أعد الإصدار')
}

/** يضيف سطراً لسجل الجهاز — أفضل جهد: فشل القراءة يتخطى السجل بدل مسح تاريخه. */
export async function appendLog(deviceId: string, text: string): Promise<boolean> {
  const logKey = `log:${deviceId}`
  try {
    const prev = await readForUpdate('license', logKey)
    const r = await bridge.cf.put('license', logKey, appendDeviceLogEntry(prev, text))
    return r.ok
  } catch {
    return false
  }
}

/**
 * Burn a license: add the fingerprint to the revocation list (both namespaces) + flag the record.
 * مساحة الخدمات غير المضبوطة (ns_missing) لا تُفشل الحرق — تُعاد كملاحظة.
 */
export async function revokeLicense(fingerprintOrKey: string): Promise<{ fingerprint: string; notes: string[] }> {
  const fingerprint = /^[0-9a-f]{8}$/.test(fingerprintOrKey) ? fingerprintOrKey : keyFingerprint(fingerprintOrKey)
  const notes: string[] = []
  for (const ns of ['license', 'services'] as const) {
    let raw: string | null
    try {
      raw = await readForUpdate(ns, 'revoked')
    } catch (e) {
      if (ns === 'services' && (e as { code?: string }).code === 'ns_missing') { notes.push('مساحة الخدمات غير مضبوطة — حُرق في مساحة التراخيص فقط'); continue }
      throw e
    }
    let list: unknown = []
    try { list = raw ? JSON.parse(raw) : [] } catch { list = [] } // قائمة تالفة لا يقرؤها أحد أصلاً
    const clean = Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
    if (!clean.includes(fingerprint)) {
      clean.push(fingerprint)
      const r = await bridge.cf.put(ns, 'revoked', JSON.stringify(clean))
      if (!r.ok) throw new Error(r.error ?? 'تعذر الكتابة في Cloudflare')
    }
  }
  let deviceId: string | undefined
  const rec = await bridge.cf.get('license', `lic:${fingerprint}`)
  if (!rec.ok) notes.push('حُرق المفتاح، لكن تعذر قراءة سجله فلم تُعلَّم بطاقة الاشتراك — قائمة الحرق كافية لرفضه')
  if (rec.ok && rec.value) {
    try {
      const o = JSON.parse(rec.value) as { revoked?: boolean; payload?: { deviceId?: string } }
      deviceId = typeof o.payload?.deviceId === 'string' ? o.payload.deviceId : undefined
      if (o.revoked !== true) {
        o.revoked = true
        const w = await bridge.cf.put('license', `lic:${fingerprint}`, JSON.stringify(o))
        if (!w.ok) notes.push('حُرق المفتاح، لكن تعذر تعليم سجله بالحرق — قائمة الحرق كافية لرفضه')
      }
    } catch { /* record unreadable — revocation list is the source of truth */ }
  }
  if (deviceId) {
    await appendLog(deviceId, `حرق المفتاح ${fingerprint}`)
    // بطاقة الاشتراك: لا نُبقي فيها مفتاحاً محروقاً (حتى لا يحاول التطبيق تطبيقه تلقائياً)
    try {
      const subRaw = await readForUpdate('services', `sub:${deviceId}`)
      if (subRaw) {
        const sub = JSON.parse(subRaw) as Record<string, unknown>
        if (sub.fingerprint === fingerprint) {
          delete sub.key
          delete sub.fingerprint
          await bridge.cf.put('services', `sub:${deviceId}`, JSON.stringify(sub))
        }
      }
    } catch { /* أفضل جهد — قائمة الحرق هي الحقيقة */ }
  }
  await audit('license_revoke', deviceId ?? fingerprint, { fingerprint })
  return { fingerprint, notes }
}

/** Send a notification to the resolved targets. Returns the number of device lists written. */
export async function sendNotice(input: { title?: string; body: string; expiresAt?: string | null; targeting: NoticeTargeting; customers: readonly CustomerView[] }): Promise<{ targets: number; mode: 'global' | 'devices'; failed: string[] }> {
  const bodyError = validateNoticeBody(input.body)
  if (bodyError) throw new Error(bodyError)
  const notice = buildNotice({ title: input.title, body: input.body, expiresAt: input.expiresAt ?? null })
  const resolved = resolveTargetDevices(input.targeting, input.customers)
  if (resolved.mode === 'global') {
    const cur = await readForUpdate('license', 'notices:global')
    const r = await bridge.cf.put('license', 'notices:global', appendNotice(cur, notice))
    if (!r.ok) throw new Error(r.error ?? 'تعذر الكتابة في Cloudflare')
  }
  // أجهزة متعددة: نكمل الباقين عند فشل جهاز (بدل التوقف في المنتصف)، ونعيد قائمة من لم يصلهم —
  // إعادة الإرسال للكل كانت ستكرر الإشعار عند من وصلهم.
  const failed: string[] = []
  let lastError = ''
  if (resolved.mode === 'devices') {
    if (resolved.deviceIds.length === 0) throw new Error('لا يوجد عملاء مطابقون للاستهداف')
    for (const deviceId of resolved.deviceIds) {
      const key = `notices:${deviceId}`
      try {
        const cur = await readForUpdate('license', key)
        const r = await bridge.cf.put('license', key, appendNotice(cur, notice))
        if (!r.ok) throw new Error(r.error ?? `تعذر الكتابة للجهاز ${deviceId}`)
      } catch (e) {
        failed.push(deviceId)
        lastError = e instanceof Error ? e.message : String(e)
      }
    }
    if (failed.length === resolved.deviceIds.length) throw new Error(lastError || 'تعذر الإرسال لأي جهاز')
  }
  await audit('notice_send', resolved.mode === 'global' ? 'all' : `${resolved.deviceIds.length} device`, {
    title: notice.title,
    targeting: describeTargeting(input.targeting, input.customers),
    expiresAt: notice.expiresAt,
    ...(failed.length ? { failed: failed.length } : {}),
  })
  return {
    targets: resolved.mode === 'global' ? input.customers.length : resolved.deviceIds.length - failed.length,
    mode: resolved.mode,
    failed,
  }
}

/** Reply to a support ticket (appends a developer message to chat:<deviceId>). */
export async function replySupport(deviceId: string, text: string): Promise<void> {
  const err = validateReply(text)
  if (err) throw new Error(err)
  const cur = await readForUpdate('services', `chat:${deviceId}`)
  const next = appendChatMessage(cur, 'developer', text)
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
  // دمج مع الموجود: البوت قد يحفظ في settings:global حقولاً أخرى لا تعرفها اللوحة
  const prevRaw = await readForUpdate('license', 'settings:global')
  let prev: Record<string, unknown> = {}
  try {
    const o = prevRaw ? JSON.parse(prevRaw) as unknown : {}
    if (o && typeof o === 'object' && !Array.isArray(o)) prev = o as Record<string, unknown>
  } catch { prev = {} }
  const r = await bridge.cf.put('license', 'settings:global', JSON.stringify({ ...prev, ...settings }))
  if (!r.ok) throw new Error(r.error ?? 'تعذر الكتابة في Cloudflare')
  await audit('settings_global_update', undefined, { plan: settings.plan, days: settings.days })
}

/** Cloud feature flags (services namespace flags:<deviceId>) — disable/enable a granted feature temporarily. */
export async function setCloudFlag(deviceId: string, feature: LicenseFeature, disabled: boolean, noteAr?: string): Promise<void> {
  const key = `flags:${deviceId}`
  const cur = await readForUpdate('services', key)
  let flags: { disabledFeatures?: string[]; noteAr?: string; updatedAt?: string } = {}
  try { flags = cur ? JSON.parse(cur) as typeof flags : {} } catch { flags = {} }
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) flags = {}
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
  // فشل القراءة يُرمى: «لا شيء مطفأ» كان يُعرض والميزة مطفأة فعلاً عند العميل
  if (!cur.ok) throw new Error(cur.error ?? 'تعذر قراءة حالة الإطفاء')
  if (!cur.value) return { disabledFeatures: [], noteAr: '' }
  try {
    const o = JSON.parse(cur.value) as { disabledFeatures?: unknown; noteAr?: unknown }
    return {
      disabledFeatures: Array.isArray(o?.disabledFeatures) ? o.disabledFeatures.filter((x): x is string => typeof x === 'string') : [],
      noteAr: typeof o?.noteAr === 'string' ? o.noteAr : '',
    }
  } catch {
    return { disabledFeatures: [], noteAr: '' }
  }
}

/**
 * الحمولة التي ستُوقَّع — مصدر واحد للإصدار وللمعاينة (كانت المعاينة نسخة مكررة بلا إزالة
 * تكرار الميزات/الأقسام، فتعرض شيئاً غير ما يُوقَّع فعلاً).
 */
function buildPayload(input: IssueLicenseInput): LicensePayload {
  const modules = finalModules(input.extraModules ?? [])
  return {
    v: 1,
    deviceId: input.deviceId,
    customer: input.customer,
    plan: input.plan,
    features: [...new Set(input.features)],
    issuedAt: new Date().toISOString().slice(0, 10),
    expiresAt: input.plan === 'lifetime' ? null : expiresAfterDays(input.days),
    ...(input.extraUsers ? { extraUsers: input.extraUsers } : {}),
    ...(input.extraBranches ? { extraBranches: input.extraBranches } : {}),
    ...(input.activityId ? { activityId: input.activityId } : {}),
    ...(modules.length ? { extraModules: modules } : {}),
  }
}

/** Canonical payload preview — for the UI to show exactly what will be signed. */
export function previewPayload(input: IssueLicenseInput): LicensePayload {
  return buildPayload(input)
}

export { canonicalPayload }

/* ─── الإصدار: البحث عن الجهاز + الافتراضيات + إرسال المفتاح ─── */

/**
 * يقرأ عميلاً واحداً مباشرة من KV بمعرّف جهازه (بلا انتظار تحميل كل العملاء) —
 * لكتابة اسمه ونشاطه وأقسامه تلقائياً في نموذج الإصدار.
 */
export async function lookupDevice(deviceId: string): Promise<CustomerView | null> {
  // فشل القراءة يرمي (لا يُعامل كجهاز جديد) — وإلا عُبّئ النموذج بالافتراضيات وسُحبت من العميل أقسامه وميزاته
  const devRaw = await readForUpdate('license', `dev:${deviceId}`)
  if (!devRaw) return null
  let fingerprint: string | undefined
  try {
    const fp = (JSON.parse(devRaw) as { fingerprint?: unknown }).fingerprint
    fingerprint = typeof fp === 'string' && fp ? fp : undefined
  } catch { /* ignore */ }
  const [licRaw, revokedRaw] = await Promise.all([
    fingerprint ? readForUpdate('license', `lic:${fingerprint}`) : Promise.resolve(null),
    readForUpdate('license', 'revoked'),
  ])
  let revoked: unknown = []
  try { revoked = revokedRaw ? JSON.parse(revokedRaw) : [] } catch { revoked = [] }
  const views = buildCustomerViews({
    devEntries: [[deviceId, devRaw]],
    licEntries: fingerprint ? [[fingerprint, licRaw]] : [],
    logEntries: [], emailEntries: [], chatEntries: [],
    revoked: Array.isArray(revoked) ? revoked.filter((x): x is string => typeof x === 'string') : [],
    todayIso: new Date().toISOString().slice(0, 10),
  })
  return views[0] ?? null
}

/** settings:global — افتراضيات الرخص الجديدة (نفس شكل البوت). */
export async function readGlobalDefaults(): Promise<GlobalDefaults> {
  // قراءة فاشلة تُرمى (لا نعيد افتراضيات «آمنة» بصمت): صفحة الافتراضيات لا يجوز أن تحفظ فوق
  // الإعداد الحقيقي قيماً مبدئية، ونموذج الإصدار يقرر بنفسه السقوط لقيم آمنة مع تنبيه.
  const raw = await readForUpdate('license', 'settings:global')
  return parseGlobalDefaults(raw)
}

/** يرسل المفتاح للعميل داخل تطبيقه (إشعار خاص بجهازه فقط) — المفتاح لا يعمل على أي جهاز آخر. */
export async function sendKeyToCustomer(input: { deviceId: string; customer: string; key: string; fingerprint: string; summary?: string }): Promise<void> {
  const body = [
    `مرحباً ${input.customer || ''} 👋`.trim(),
    input.summary ? `تم تحديث اشتراكك: ${input.summary}` : 'تم إصدار مفتاح تفعيل جديد لجهازك.',
    'لتطبيقه: افتح شاشة الترخيص / التفعيل في البرنامج والصق المفتاح التالي:',
    input.key,
    'المفتاح خاص بجهازك ولا يعمل على أي جهاز آخر.',
  ].join('\n\n')
  const notice = buildNotice({ title: '🔑 مفتاح التفعيل الجديد', body, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() })
  const key = `notices:${input.deviceId}`
  const cur = await readForUpdate('license', key)
  const r = await bridge.cf.put('license', key, appendNotice(cur, notice))
  if (!r.ok) throw new Error(r.error ?? 'تعذر الكتابة في Cloudflare')
  await audit('license_send', input.deviceId, { fingerprint: input.fingerprint })
}

/* ─── سجل الإشعارات: عرض كامل + تعديل + حذف + إيصالات القراءة ─── */

export interface SentNoticesResult {
  notices: SentNotice[]
  readsByDevice: Map<string, Record<string, string>>
}

/** كل الإشعارات المرسلة (العامة وكل الأجهزة — بلا عيّنات) + إيصالات القراءة. */
export async function listSentNotices(): Promise<SentNoticesResult> {
  const listKeys = async (prefix: string) => {
    const all: string[] = []
    let cursor: string | undefined
    do {
      const page = await bridge.cf.listKeys('license', prefix, cursor)
      if (!page.ok) throw new Error(page.error ?? 'تعذر قراءة Cloudflare')
      all.push(...page.keys)
      cursor = page.cursor ?? undefined
    } while (cursor && all.length < 3000)
    return all
  }
  const [noticeKeys, readKeys] = await Promise.all([listKeys(NOTICE_KEY_PREFIX), listKeys(NOTICE_READ_PREFIX).catch(() => [] as string[])])
  // قراءة على دفعات (8 طلبات متزامنة) — حتى لا نصطدم بحد طلبات Cloudflare API مع كثرة العملاء
  // قوائم الإشعارات: قراءة صارمة — قائمة ناقصة تعني أن الحذف/التعديل لاحقاً يتخطى ذلك الجهاز
  // فيبقى عنده النص القديم. إيصالات القراءة: أفضل جهد (الفشل = «لا إيصال» فقط).
  const fetchAll = (keys: string[], strict: boolean) => mapLimit(keys, 8, async (k) => {
    const r = await bridge.cf.get('license', k)
    if (!r.ok && strict) throw new Error(`تعذر قراءة ${k}: ${r.error ?? 'خطأ Cloudflare'} — أعد التحميل`)
    return [k, r.ok ? r.value : null] as const
  })
  const lists = await fetchAll(noticeKeys, true)
  const reads = await fetchAll(readKeys, false)
  const readsByDevice = new Map<string, Record<string, string>>()
  for (const [k, raw] of reads) readsByDevice.set(k.slice(NOTICE_READ_PREFIX.length), parseNoticeReads(raw))
  return { notices: collectSentNotices(lists), readsByDevice }
}

/** تعديل إشعار في كل القوائم التي يوجد فيها (نفس المعرّف). */
export async function editNotice(sent: SentNotice, patch: NoticePatch): Promise<void> {
  if (patch.body !== undefined) {
    const err = validateNoticeBody(patch.body)
    if (err) throw new Error(err)
  }
  for (const key of sent.listKeys) {
    const cur = await readForUpdate('license', key)
    const { raw, changed } = editNoticeInList(cur, sent.notice.id, patch)
    if (!changed) continue
    const r = await bridge.cf.put('license', key, raw)
    if (!r.ok) throw new Error(r.error ?? 'تعذر الكتابة في Cloudflare')
  }
  await audit('notice_edit', sent.notice.id, { title: patch.title ?? sent.notice.title, lists: sent.listKeys.length })
}

/** حذف إشعار من كل القوائم — يختفي من تطبيق العميل عند أول مزامنة. */
export async function deleteNotice(sent: SentNotice): Promise<void> {
  for (const key of sent.listKeys) {
    const cur = await readForUpdate('license', key)
    const { raw, changed } = removeNoticeFromList(cur, sent.notice.id)
    if (!changed) continue
    const r = await bridge.cf.put('license', key, raw)
    if (!r.ok) throw new Error(r.error ?? 'تعذر الكتابة في Cloudflare')
  }
  await audit('notice_delete', sent.notice.id, { title: sent.notice.title, lists: sent.listKeys.length })
}
