import { create } from 'zustand'
import { bridge } from '../data/bridge.ts'
import { buildCustomerViews, parseDevRecord, parseChatSummary, type CustomerView, type ChatOnlyDevice } from '../core/customers.ts'
import { parseRegistrationRecord, type RegistrationRecord } from '../core/registrations.ts'
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
  /** أجهزة لها محادثة دعم (chat:) بلا سجل جهاز dev: — مثل عميل تعذر عليه التفعيل فراسل الدعم */
  chatOnly: ChatOnlyDevice[]
  /** تنبيه غير قاتل: قائمة بادئة تجاوزت السقف فلم تُقرأ كلها */
  warning: string | null
  /** عدّاد التسجيلات الجديدة غير المقروءة (للشريط الجانبي والتنبيه) */
  unreadNew: number
  /** آخر تسجيلات اعتُبرت جديدة — للتنبيه الصوتي/النظام */
  lastNewIds: string[]
  refresh(): Promise<void>
  /** تصفير عدّاد الجديد عند فتح صفحة التسجيلات */
  markRegistrationsSeen(): void
  /** بدء التحديث التلقائي كل N ثانية */
  startPolling(intervalMs?: number): () => void
}

const POLL_DEFAULT_MS = 60_000

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

/** ذاكرة خارج المتجر لتتبع الجديد بين التحديثات */
let seenRegIds = new Set<string>()
let notifiedIds = new Set<string>()
let pollingTimer: ReturnType<typeof setInterval> | null = null
let initialLoadDone = false

/** للاختبارات فقط — إعادة ضبط الحالة */
export function __resetRegistrationsState() {
  seenRegIds = new Set()
  notifiedIds = new Set()
  initialLoadDone = false
  try { localStorage.removeItem('controler:seenRegIds') } catch { /* ignore */ }
}

function playNewRegistrationSound() {
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
    // تنظيف بعد الانتهاء
    setTimeout(() => { try { ctx.close() } catch { /* ignore */ } }, 800)
  } catch { /* الصوت أفضل جهد — لا يُسقط التنبيه */ }
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
    try { localStorage.setItem('controler:seenRegIds', JSON.stringify(ids)) } catch { /* ignore */ }
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

  startPolling: (intervalMs = POLL_DEFAULT_MS) => {
    if (pollingTimer) clearInterval(pollingTimer)
    pollingTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void get().refresh()
    }, intervalMs)
    // تحديث فوري عند عودة التركيز
    const onFocus = () => void get().refresh()
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

type SetState = (partial: Partial<DataState>) => void
async function runRefresh(set: SetState, get: () => DataState): Promise<void> {
  set({ loading: true, error: null })

  try {
    const [devList, logList, emailList, revokedRaw, chatListed, regList] = await Promise.all([
      listAll('license', 'dev:'),
      listAll('license', 'log:'),
      listAll('license', 'email:'),
      bridge.cf.get('license', 'revoked'),
      listAll('services', 'chat:').then((list) => ({ list }), (e: unknown) => ({ error: e })),
      listAll('license', 'reg:').then((list) => ({ list }), () => ({ list: { keys: [] as string[], truncated: false } })),
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
    try {
      const list = (regList as { list: Listing }).list
      if (list) {
        regTruncated = list.truncated
        if (list.keys.length) {
          const regEntries = await getAllValues('license', list.keys)
          for (const [, raw] of regEntries) {
            const rec = parseRegistrationRecord(raw)
            if (rec) registrations.push(rec)
          }
          registrations.sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))
        }
      }
    } catch {
      // تسجيلات اختيارية — لا تُسقط التحديث
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
    const customers = buildCustomerViews({
      devEntries: strip('dev:')(devEntries),
      licEntries: strip('lic:')(licEntries),
      logEntries: strip('log:')(logEntries),
      emailEntries: strip('email:')(emailEntries),
      chatEntries: chats,
      revoked,
      todayIso: new Date().toISOString().slice(0, 10),
    })
    const chatOnly: ChatOnlyDevice[] = []
    for (const [deviceId, raw] of chats) {
      if (deviceIds.has(deviceId)) continue
      const sum = parseChatSummary(raw)
      if (sum.count > 0) chatOnly.push({ deviceId, lastSupportAt: sum.lastAt, supportUnread: sum.unread })
    }

    // حساب المعلّق (بدون رخصة): سجل dev بخطة فارغة
    const devById = new Map<string, ReturnType<typeof parseDevRecord>>()
    for (const [k, v] of strip('dev:')(devEntries)) devById.set(k, parseDevRecord(v))
    const hasLicense = (deviceId: string) => {
      const rec = devById.get(deviceId)
      return Boolean(rec && String(rec.plan ?? '').trim())
    }
    const pendingRegistrations = registrations.filter((r) => !hasLicense(r.deviceId))

    // كشف الجديد: مقارنة مع ما رُئي من قبل (من الذاكرة أو التخزين المحلي)
    const firstLoad = !initialLoadDone
    let hadStored = false
    if (firstLoad) {
      try {
        const stored = localStorage.getItem('controler:seenRegIds')
        if (stored) {
          const parsed = JSON.parse(stored) as string[]
          seenRegIds = new Set(parsed)
          for (const id of parsed) notifiedIds.add(id)
          hadStored = parsed.length > 0
        } else if (registrations.length) {
          const ids = registrations.map((r) => r.deviceId)
          seenRegIds = new Set(ids)
          for (const id of ids) notifiedIds.add(id)
          hadStored = false
        }
      } catch { /* ignore */ }
    }
    // الحساب الموثوق للبادج: كل معلّق لم يُرَ
    const unreadNew = pendingRegistrations.filter((r) => !seenRegIds.has(r.deviceId)).length
    // للتنبيه: فقط من لم نُنبّه عنه من قبل (حتى لا نكرر كل دقيقة لنفس العميل)
    const notifyCandidates = pendingRegistrations.filter((r) => !notifiedIds.has(r.deviceId)).map((r) => r.deviceId)
    // يُسمح بالتنبيه في أول تحميل فقط إن كان هناك سجل محفوظ سابقاً وجاء جديد أثناء الإغلاق
    const shouldNotify = notifyCandidates.length > 0 && seenRegIds.size > 0 && (!firstLoad || hadStored)
    let lastNewIds: string[] = get().lastNewIds
    if (notifyCandidates.length && shouldNotify) {
      try {
        const first = pendingRegistrations.find((r) => notifyCandidates.includes(r.deviceId))
        const title = `🆕 تسجيل عميل جديد${notifyCandidates.length > 1 ? ` (+${notifyCandidates.length - 1})` : ''}`
        const body = first ? `${first.shopName || first.ownerName || 'عميل جديد'} — ${first.phone || first.email || first.deviceId}` : `${notifyCandidates.length} عميل جديد`
        // 1) تنبيه المتصفح
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(title, { body })
        } else if ('Notification' in window && Notification.permission !== 'denied') {
          void Notification.requestPermission().then((perm) => {
            if (perm === 'granted') new Notification(title, { body })
          })
        }
        // 2) تنبيه نظام ويندوز عبر Electron
        try { void bridge.app.notify(title, body) } catch { /* أفضل جهد */ }
        const w = window as unknown as { controlerDesktop?: Record<string, unknown> }
        const legacy = w.controlerDesktop?.['app:notify'] as ((p: { title: string; body: string }) => Promise<unknown>) | undefined
        if (typeof legacy === 'function') void legacy({ title, body }).catch(() => {})
        // 3) صوت تنبيه داخل اللوحة
        playNewRegistrationSound()
        // 4) تيليجرام للمطور (أفضل جهد — لا يُسقط التحديث)
        try {
          const tgText = `🆕 تسجيل عميل جديد (${notifyCandidates.length})\n${pendingRegistrations.filter(r=>notifyCandidates.includes(r.deviceId)).map(r=> `• ${r.shopName||'بلا اسم'} — ${r.ownerName||''} — ${r.phone||r.email||r.deviceId}\n  ${r.city ? `${r.city} — ` : ''}${r.activityNameAr||r.activityId||''}`).join('\n')}`
          void bridge.tg.send(tgText).catch(() => {})
        } catch { /* ignore */ }
        lastNewIds = notifyCandidates
        for (const id of notifyCandidates) notifiedIds.add(id)
      } catch { /* best effort */ }
    } else if (notifyCandidates.length && firstLoad && !hadStored) {
      // تثبيت أول مرّة بلا سجل محفوظ: لا تنبيه لكن نحفظ كـ "مُنبَّه" حتى لا يزعج لاحقاً
      lastNewIds = []
      for (const id of notifyCandidates) notifiedIds.add(id)
    } else if (pendingRegistrations.length === 0) {
      lastNewIds = []
    } else if (notifyCandidates.length === 0 && lastNewIds.length > 0) {
      // لا جديد لكن آخر تنبيه ما زال يظهر — يُصفّى فقط عند markSeen أو عند انتهاء pending
      // (نُبقيه ظاهراً حتى يفتح المستخدم الصفحة)
    }
    if (firstLoad) initialLoadDone = true

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

    const at = new Date().toISOString()
    set({ customers, registrations, pendingRegistrations, chatOnly, warning, loading: false, lastSyncAt: at, servicesAvailable, servicesError, unreadNew, lastNewIds })
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
