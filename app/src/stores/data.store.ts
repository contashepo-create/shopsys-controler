import { create } from 'zustand'
import { bridge } from '../data/bridge.ts'
import { buildCustomerViews, parseDevRecord, parseChatSummary, type CustomerView, type ChatOnlyDevice } from '../core/customers.ts'
import { normalizeActivityId } from '../core/activities.ts'
import { parseRegistrationRecord, sortRegistrationsByNewest, type RegistrationRecord } from '../core/registrations.ts'
import { mapLimit } from '../core/concurrency.ts'

interface DataState {
  customers: CustomerView[]
  registrations: RegistrationRecord[]
  /** سجلات التسجيل التي لم يُصدَر لها مفتاح بعد (حالة بدون اشتراك) */
  pendingRegistrations: RegistrationRecord[]
  loading: boolean
  error: string | null
  lastSyncAt: string | null
  /** مساحة الخدمات (الدعم/الأعلام/الاشتراكات/التحديثات) متاحة؟ */
  servicesAvailable: boolean
  servicesError: string | null
  /** أجهزة لها محادثة دعم (chat:) بلا سجل جهاز dev: أو reg: — مثل عميل قديم راسل الدعم */
  chatOnly: ChatOnlyDevice[]
  /** تنبيه غير قاتل: قائمة بادئة تجاوزت السقف فلم تُقرأ كلها */
  warning: string | null
  /** عدّاد التسجيلات الجديدة غير المقروءة (للشريط الجانبي والتنبيه) */
  unreadNew: number
  /** آخر تسجيلات اعتُبرت جديدة — للتنبيه الصوتي/النظام */
  lastNewIds: string[]
  /** تحديث كامل لكل البيانات (عند الفتح الأول أو الضغط اليدوي أو إصدار رخصة) */
  refresh(): Promise<void>
  /**
   * فحص تفاضلي خفيف لبادئة reg: فقط (طلب listKeys واحد + صفر GET عند السكون)
   * لحماية الحصة المجانية اليومية في Cloudflare KV.
   * @param ifStaleMs إن مُرّر، يتخطى الفحص إن كان آخر فحص أحدث من هذه المدة (مللي ثانية).
   */
  pollRegistrations(ifStaleMs?: number): Promise<void>
  /** تصفير عدّاد الجديد عند فتح صفحة التسجيلات */
  markRegistrationsSeen(): void
  /** بدء الفحص الدوري الخفيف للتسجيلات الجديدة */
  startPolling(intervalMs?: number): () => void
}

/** دقيقتان افتراضياً: 30 عملية list/ساعة فقط (~240 في 8 ساعات عمل من أصل 1000 مجانية يومياً) */
export const POLL_DEFAULT_MS = 120_000
/** تهدئة عند عودة التركيز للنافذة لمنع استنزاف الطلبات مع Alt+Tab */
export const FOCUS_COOLDOWN_MS = 60_000

/** سقف أمان لكل بادئة (يُنبَّه عند بلوغه بدل القصّ الصامت) */
export const MAX_KEYS_PER_PREFIX = 5000
/** أقصى طلبات قراءة متزامنة في التحديث كله — بدل آلاف الطلبات دفعة واحدة */
export const READ_CONCURRENCY = 12

async function getAllValues(ns: 'license' | 'services', keys: readonly string[]): Promise<(readonly [string, string | null])[]> {
  return mapLimit(keys, READ_CONCURRENCY, async (key) => {
    const r = await bridge.cf.get(ns, key)
    if (!r.ok) {
      const err = new Error(`تعذر قراءة ${key}: ${r.error ?? 'خطأ Cloudflare'} — بقيت البيانات السابقة، أعد التحديث بعد قليل`) as Error & { code?: string }
      err.code = r.code
      throw err
    }
    return [key, r.value] as const
  })
}

interface Listing { keys: string[]; truncated: boolean }

async function listAll(ns: 'license' | 'services', prefix: string): Promise<Listing> {
  const all: string[] = []
  let cursor: string | undefined
  do {
    const page = await bridge.cf.listKeys(ns, prefix, cursor)
    if (!page.ok) {
      const err = new Error(page.error ?? 'تعذر قراءة Cloudflare') as Error & { code?: string }
      err.code = page.code
      throw err
    }
    all.push(...page.keys)
    cursor = page.cursor ?? undefined
  } while (cursor && all.length < MAX_KEYS_PER_PREFIX)
  return { keys: all.slice(0, MAX_KEYS_PER_PREFIX), truncated: Boolean(cursor) || all.length > MAX_KEYS_PER_PREFIX }
}

/** ذاكرة خارج المتجر لتتبع الجديد وتجنب إعادة قراءة سجلات reg: المعروفة في كل دورة */
let seenRegIds = new Set<string>()
let notifiedIds = new Set<string>()
let knownRegCache = new Map<string, RegistrationRecord | null>()
let licensedDeviceIds = new Set<string>()
let devBackedIds = new Set<string>()
let pollingTimer: ReturnType<typeof setInterval> | null = null
let initialLoadDone = false
let lastCheckAt = 0
let refreshEpoch = 0

/** للاختبارات فقط — إعادة ضبط الحالة */
export function __resetRegistrationsState() {
  seenRegIds = new Set()
  notifiedIds = new Set()
  knownRegCache = new Map()
  licensedDeviceIds = new Set()
  devBackedIds = new Set()
  initialLoadDone = false
  lastCheckAt = 0
  refreshEpoch = 0
  pollInflight = null
  if (pollingTimer) {
    clearInterval(pollingTimer)
    pollingTimer = null
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem('controler:seenRegIds')
  } catch { /* ignore */ }
}

/**
 * دمج سجلات التسجيل (reg:) مع قائمة العملاء المبنية من (dev:):
 *  1) العملاء الموجودون في dev: يُكمَّل لهم آخر ظهور الأحدث والاسم والبريد والنشاط إن كانت ناقصة.
 *  2) العملاء الجدد الذين لهم reg: فقط ولم يُصدَر لهم مفتاح بعد (لا يوجد لهم dev:) يُدرجون
 *     بحالة status='none' («بدون اشتراك») ليظهروا فوراً في جدول العملاء ولوحة التحكم والدعم.
 */
export function mergeRegistrationsIntoCustomers(
  baseCustomers: readonly CustomerView[],
  registrations: readonly RegistrationRecord[],
  chatsByDevice?: ReadonlyMap<string, string | null>,
): CustomerView[] {
  if (registrations.length === 0) return [...baseCustomers]
  const regById = new Map<string, RegistrationRecord>()
  for (const r of registrations) regById.set(r.deviceId, r)

  const seen = new Set<string>()
  const merged: CustomerView[] = baseCustomers.map((c) => {
    seen.add(c.deviceId)
    const r = regById.get(c.deviceId)
    if (!r) return c
    const regSeen = r.lastSeenAt || null
    const bestSeen = c.lastSeenAt && regSeen
      ? (regSeen > c.lastSeenAt ? regSeen : c.lastSeenAt)
      : (c.lastSeenAt ?? regSeen)
    return {
      ...c,
      customer: c.customer || r.shopName || r.ownerName || '',
      email: c.email ?? (r.email || null),
      clientActivityId: c.clientActivityId ?? normalizeActivityId(r.activityId),
      lastSeenAt: bestSeen,
    }
  })

  for (const r of registrations) {
    if (seen.has(r.deviceId)) continue
    seen.add(r.deviceId)
    const chat = parseChatSummary(chatsByDevice?.get(r.deviceId) ?? null)
    merged.push({
      deviceId: r.deviceId,
      customer: r.shopName || r.ownerName || '',
      email: r.email || null,
      plan: '',
      expiresAt: null,
      activityId: null,
      clientActivityId: normalizeActivityId(r.activityId),
      features: [],
      extraUsers: 0,
      extraBranches: 0,
      extraModules: [],
      fingerprint: null,
      licenseKey: null,
      licenseIssuedAt: null,
      lastSeenAt: r.lastSeenAt || null,
      status: 'none',
      lastActivityAt: null,
      lastSupportAt: chat.lastAt,
      supportUnread: chat.unread,
      message: '',
    })
  }
  return merged
}

function playNewRegistrationSound() {
  if (typeof window === 'undefined') return
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = 880
    o.connect(g); g.connect(ctx.destination)
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
    o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.36)
    setTimeout(() => { try { void ctx.close() } catch { /* ignore */ } }, 800)
  } catch { /* الصوت أفضل جهد — لا يُسقط التنبيه */ }
}

function readStoredSeenIds(): string[] | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const stored = localStorage.getItem('controler:seenRegIds')
    if (stored === null) return null
    const parsed = JSON.parse(stored) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : null
  } catch {
    return null
  }
}

function writeStoredSeenIds(ids: readonly string[]) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('controler:seenRegIds', JSON.stringify(ids))
    }
  } catch { /* ignore */ }
}

function computeRegistrationAlerts(
  registrations: RegistrationRecord[],
  hasLicense: (deviceId: string) => boolean,
): { pendingRegistrations: RegistrationRecord[]; unreadNew: number; lastNewIds: string[] } {
  const pendingRegistrations = registrations.filter((r) => !hasLicense(r.deviceId))

  const firstLoad = !initialLoadDone
  let hadStored = false
  if (firstLoad) {
    const storedIds = readStoredSeenIds()
    if (storedIds !== null) {
      seenRegIds = new Set(storedIds)
      for (const id of storedIds) notifiedIds.add(id)
      hadStored = true
    } else {
      const ids = registrations.map((r) => r.deviceId)
      seenRegIds = new Set(ids)
      for (const id of ids) notifiedIds.add(id)
      writeStoredSeenIds(ids)
      hadStored = false
    }
  }

  const unseenPendingIds = pendingRegistrations.filter((r) => !seenRegIds.has(r.deviceId)).map((r) => r.deviceId)
  const unreadNew = unseenPendingIds.length
  const notifyCandidates = pendingRegistrations.filter((r) => !notifiedIds.has(r.deviceId)).map((r) => r.deviceId)
  const shouldNotify = notifyCandidates.length > 0 && (!firstLoad || hadStored)

  if (notifyCandidates.length && shouldNotify) {
    try {
      const candidateSet = new Set(notifyCandidates)
      const newRecords = pendingRegistrations.filter((r) => candidateSet.has(r.deviceId))
      const first = newRecords[0]
      const title = `🆕 تسجيل عميل جديد${notifyCandidates.length > 1 ? ` (+${notifyCandidates.length - 1})` : ''}`
      const body = first ? `${first.shopName || first.ownerName || 'عميل جديد'} — ${first.phone || first.email || first.deviceId}` : `${notifyCandidates.length} عميل جديد`
      if (bridge.runtime === 'electron') {
        try { void bridge.app.notify(title, body).catch(() => {}) } catch { /* أفضل جهد */ }
      } else if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification(title, { body })
        } else if (Notification.permission !== 'denied') {
          void Notification.requestPermission().then((perm) => {
            if (perm === 'granted') new Notification(title, { body })
          })
        }
      }
      playNewRegistrationSound()
      try {
        const preview = newRecords.slice(0, 15).map((r) => `• ${r.shopName || 'بلا اسم'} — ${r.ownerName || '—'} — ${r.phone || r.email || r.deviceId}${r.city || r.activityNameAr || r.activityId ? `\n  ${r.city ? `${r.city} — ` : ''}${r.activityNameAr || r.activityId || ''}` : ''}`).join('\n')
        const extra = newRecords.length > 15 ? `\n… و${newRecords.length - 15} تسجيلات أخرى` : ''
        const tgText = `🆕 تسجيل عميل جديد (${notifyCandidates.length})\n${preview}${extra}`
        void bridge.tg.send(tgText).catch(() => {})
      } catch { /* ignore */ }
      for (const id of notifyCandidates) notifiedIds.add(id)
    } catch { /* best effort */ }
  } else if (notifyCandidates.length && firstLoad && !hadStored) {
    for (const id of notifyCandidates) notifiedIds.add(id)
  }

  if (firstLoad) initialLoadDone = true
  const lastNewIds = unseenPendingIds.filter((id) => notifiedIds.has(id))
  return { pendingRegistrations, unreadNew, lastNewIds }
}

export const useDataStore = create<DataState>((set, get) => ({
  customers: [],
  registrations: [],
  pendingRegistrations: [],
  loading: false,
  error: null,
  lastSyncAt: null,
  servicesAvailable: true,
  servicesError: null,
  chatOnly: [],
  warning: null,
  unreadNew: 0,
  lastNewIds: [],

  markRegistrationsSeen: () => {
    const ids = get().registrations.map((r) => r.deviceId)
    seenRegIds = new Set(ids)
    for (const id of ids) notifiedIds.add(id)
    writeStoredSeenIds(ids)
    set({ unreadNew: 0, lastNewIds: [] })
  },

  refresh: () => {
    if (inflight) {
      queued ??= inflight.then(() => { queued = null; return get().refresh() })
      return queued
    }
    inflight = runRefresh(set, get).finally(() => { inflight = null })
    return inflight
  },

  pollRegistrations: (ifStaleMs = 0) => {
    if (ifStaleMs > 0 && initialLoadDone && Date.now() - lastCheckAt < ifStaleMs) {
      return Promise.resolve()
    }
    if (!initialLoadDone) {
      return get().refresh()
    }
    if (inflight) return inflight
    if (pollInflight) return pollInflight
    pollInflight = runPollRegistrations(set, get).finally(() => { pollInflight = null })
    return pollInflight
  },

  startPolling: (intervalMs = POLL_DEFAULT_MS) => {
    if (pollingTimer) clearInterval(pollingTimer)
    pollingTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void get().pollRegistrations()
    }, intervalMs)
    const onFocus = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      void get().pollRegistrations(FOCUS_COOLDOWN_MS)
    }
    if (typeof window !== 'undefined') window.addEventListener('focus', onFocus)
    return () => {
      if (pollingTimer) clearInterval(pollingTimer)
      pollingTimer = null
      if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus)
    }
  },
}))

let inflight: Promise<void> | null = null
let queued: Promise<void> | null = null
let pollInflight: Promise<void> | null = null

type SetState = (partial: Partial<DataState>) => void

async function runPollRegistrations(set: SetState, get: () => DataState): Promise<void> {
  const epochAtStart = refreshEpoch
  try {
    const regListed = await listAll('license', 'reg:')
    if (refreshEpoch !== epochAtStart || inflight) return
    lastCheckAt = Date.now()

    const currentKeys = new Set(regListed.keys)
    const deletedKeys: string[] = []
    for (const cachedKey of knownRegCache.keys()) {
      if (!currentKeys.has(cachedKey)) deletedKeys.push(cachedKey)
    }

    const missingKeys = regListed.keys.filter((k) => !knownRegCache.has(k))
    if (missingKeys.length === 0 && deletedKeys.length === 0) {
      return
    }

    // نجلب كل البيانات المطلوبة أولاً قبل تعديل الذاكرة حتى لا نفقد إعادة المحاولة عند فشل جزئي
    const fetchedRegs: (readonly [string, RegistrationRecord | null])[] = []
    const fetchedDevs: (readonly [string, string | null])[] = []
    if (missingKeys.length > 0) {
      const newEntries = await getAllValues('license', missingKeys)
      const newDeviceIds: string[] = []
      for (const [k, raw] of newEntries) {
        const rec = parseRegistrationRecord(raw, k.slice('reg:'.length))
        fetchedRegs.push([k, rec])
        if (rec) newDeviceIds.push(rec.deviceId)
      }
      if (newDeviceIds.length > 0) {
        const devEntries = await getAllValues('license', newDeviceIds.map((id) => `dev:${id}`))
        fetchedDevs.push(...devEntries)
      }
    }

    // إن بدأ أو اكتمل تحديث شامل أثناء انتظار الشبكة، نلغي نتيجة الفحص الأقدم
    if (refreshEpoch !== epochAtStart || inflight) return

    for (const k of deletedKeys) knownRegCache.delete(k)
    for (const [k, rec] of fetchedRegs) knownRegCache.set(k, rec)
    for (const [k, raw] of fetchedDevs) {
      const id = k.slice('dev:'.length)
      if (raw != null) devBackedIds.add(id)
      const devRec = parseDevRecord(raw)
      if (devRec && String(devRec.plan ?? '').trim()) licensedDeviceIds.add(id)
      else licensedDeviceIds.delete(id)
    }

    const unsorted: RegistrationRecord[] = []
    for (const rec of knownRegCache.values()) {
      if (rec) unsorted.push(rec)
    }
    const registrations = sortRegistrationsByNewest(unsorted)

    const baseCustomers = get().customers.filter(
      (c) => devBackedIds.has(c.deviceId) || Boolean(c.plan || c.fingerprint || c.licenseKey),
    )
    const customers = mergeRegistrationsIntoCustomers(baseCustomers, registrations)

    const customerLicensed = new Set(
      customers.filter((c) => Boolean(String(c.plan ?? '').trim())).map((c) => c.deviceId),
    )
    const hasLicense = (deviceId: string) => licensedDeviceIds.has(deviceId) || customerLicensed.has(deviceId)
    const { pendingRegistrations, unreadNew, lastNewIds } = computeRegistrationAlerts(registrations, hasLicense)

    set({ customers, registrations, pendingRegistrations, unreadNew, lastNewIds })
  } catch {
    // الفحص الدوري في الخلفية لا يُسقط البيانات الحالية عند خطأ شبكة عابر
  }
}

async function runRefresh(set: SetState, get: () => DataState): Promise<void> {
  refreshEpoch += 1
  set({ loading: true, error: null })

  try {
    const [devList, logList, emailList, revokedRaw, chatListed, regListed] = await Promise.all([
      listAll('license', 'dev:'),
      listAll('license', 'log:'),
      listAll('license', 'email:'),
      bridge.cf.get('license', 'revoked'),
      listAll('services', 'chat:').then((list) => ({ list }), (e: unknown) => ({ error: e })),
      listAll('license', 'reg:').then((list) => ({ ok: true as const, list }), () => ({ ok: false as const })),
    ])
    if (!revokedRaw.ok) throw Object.assign(new Error(`تعذر قراءة قائمة الحرق: ${revokedRaw.error ?? ''}`), { code: revokedRaw.code })

    const devEntries = await getAllValues('license', devList.keys)
    const deviceIds = new Set(devEntries.map(([k]) => k.slice('dev:'.length)))
    const fingerprints = new Set<string>()
    for (const [, raw] of devEntries) {
      const fp = parseDevRecord(raw).fingerprint
      if (typeof fp === 'string' && fp) fingerprints.add(fp)
    }

    const licKeys = [...fingerprints].map((fp) => `lic:${fp}`)
    const logKeys = logList.keys.filter((k) => deviceIds.has(k.slice('log:'.length)))
    const groups = [licKeys, logKeys, emailList.keys]
    const values = await getAllValues('license', groups.flat())
    const bounds = groups.reduce<number[]>((acc, keys) => [...acc, acc[acc.length - 1] + keys.length], [0])
    const [licEntries, logEntries, emailEntries] = groups.map((_, i) => values.slice(bounds[i], bounds[i + 1]))

    let revoked: string[] = []
    try { revoked = revokedRaw.value ? JSON.parse(revokedRaw.value) as string[] : [] } catch { revoked = [] }
    if (!Array.isArray(revoked)) revoked = []
    revoked = revoked.filter((x): x is string => typeof x === 'string')

    // التسجيلات — تُقرأ حتى لو فشلت الخدمات
    let registrations: RegistrationRecord[] = []
    let regTruncated = false
    let regReadOk = false
    try {
      if (!regListed.ok) throw new Error('reg_list_failed')
      const list = regListed.list
      regTruncated = list.truncated
      const nextRegCache = new Map<string, RegistrationRecord | null>()
      const parsedRegs: RegistrationRecord[] = []
      if (list.keys.length) {
        const regEntries = await getAllValues('license', list.keys)
        for (const [k, raw] of regEntries) {
          const rec = parseRegistrationRecord(raw, k.slice('reg:'.length))
          nextRegCache.set(k, rec)
          if (rec) parsedRegs.push(rec)
        }
      }
      registrations = sortRegistrationsByNewest(parsedRegs)
      knownRegCache = nextRegCache
      regReadOk = true
    } catch {
      // تسجيلات اختيارية — لا تُسقط التحديث وتحافظ على النسخة السابقة دون تلويث خط الأساس
      registrations = get().registrations
    }

    let chatEntries: (readonly [string, string | null])[] = []
    let servicesAvailable = true
    let servicesError: string | null = null
    let chatTruncated = false
    try {
      if ('error' in chatListed) throw chatListed.error
      chatTruncated = (chatListed as { list: Listing }).list.truncated
      chatEntries = await getAllValues('services', (chatListed as { list: Listing }).list.keys)
    } catch (e) {
      servicesAvailable = false
      servicesError = e instanceof Error ? e.message : String(e)
    }

    const strip = (prefix: string) => (entries: readonly (readonly [string, string | null])[]) =>
      entries.map(([k, v]) => [k.slice(prefix.length), v] as const)

    const chats = strip('chat:')(chatEntries)
    const chatsMap = new Map<string, string | null>(chats)
    const baseCustomers = buildCustomerViews({
      devEntries: strip('dev:')(devEntries),
      licEntries: strip('lic:')(licEntries),
      logEntries: strip('log:')(logEntries),
      emailEntries: strip('email:')(emailEntries),
      chatEntries: chats,
      revoked,
      todayIso: new Date().toISOString().slice(0, 10),
    })
    devBackedIds = new Set(deviceIds)
    const customers = mergeRegistrationsIntoCustomers(baseCustomers, registrations, chatsMap)
    const regDeviceIds = new Set(registrations.map((r) => r.deviceId))

    const chatOnly: ChatOnlyDevice[] = []
    for (const [deviceId, raw] of chats) {
      if (deviceIds.has(deviceId) || regDeviceIds.has(deviceId)) continue
      const sum = parseChatSummary(raw)
      if (sum.count > 0) chatOnly.push({ deviceId, lastSupportAt: sum.lastAt, supportUnread: sum.unread })
    }

    // حساب المعلّق (بدون رخصة): سجل dev بخطة فارغة أو غير موجود بعد
    const nextLicensed = new Set<string>()
    for (const [k, v] of strip('dev:')(devEntries)) {
      const parsed = parseDevRecord(v)
      if (parsed && String(parsed.plan ?? '').trim()) nextLicensed.add(k)
    }
    licensedDeviceIds = nextLicensed
    const hasLicense = (deviceId: string) => nextLicensed.has(deviceId)
    const alerts = regReadOk
      ? computeRegistrationAlerts(registrations, hasLicense)
      : { pendingRegistrations: get().pendingRegistrations, unreadNew: get().unreadNew, lastNewIds: get().lastNewIds }

    const truncated = [
      devList.truncated && 'الأجهزة (dev:)',
      logList.truncated && 'سجلات النشاط (log:)',
      emailList.truncated && 'البريد (email:)',
      regTruncated && 'التسجيلات (reg:)',
      chatTruncated && 'محادثات الدعم (chat:)',
    ].filter(Boolean)
    const warning = truncated.length
      ? `تجاوز العدد ${MAX_KEYS_PER_PREFIX} في: ${truncated.join('، ')} — بعض السجلات لم تُعرض`
      : null

    lastCheckAt = Date.now()
    const at = new Date().toISOString()
    set({
      customers,
      registrations,
      pendingRegistrations: alerts.pendingRegistrations,
      chatOnly,
      warning,
      loading: false,
      lastSyncAt: at,
      servicesAvailable,
      servicesError,
      unreadNew: alerts.unreadNew,
      lastNewIds: alerts.lastNewIds,
    })
    try {
      await bridge.db.cachePut('customers:snapshot', JSON.stringify({ at, customers, registrations: registrations.slice(0, 100) }))
    } catch { /* cache is best-effort */ }
  } catch (e) {
    const code = (e as Error & { code?: string })?.code
    const message = e instanceof Error ? e.message : String(e)
    if (code === 'ns_missing' && message.includes('الخدمات')) {
      set({ loading: false, servicesAvailable: false, servicesError: message, customers: get().customers, lastSyncAt: new Date().toISOString() })
      return
    }
    set({ loading: false, error: message })
  }
}
