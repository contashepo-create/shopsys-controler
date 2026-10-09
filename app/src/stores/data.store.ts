import { create } from 'zustand'
import { bridge } from '../data/bridge.ts'
import { buildCustomerViews, parseDevRecord, parseChatSummary, type CustomerView, type ChatOnlyDevice } from '../core/customers.ts'
import { mapLimit } from '../core/concurrency.ts'

interface DataState {
  customers: CustomerView[]
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
  refresh(): Promise<void>
}

/** سقف أمان لكل بادئة (يُنبَّه عند بلوغه بدل القصّ الصامت) */
export const MAX_KEYS_PER_PREFIX = 5000
/** أقصى طلبات قراءة متزامنة في التحديث كله — بدل آلاف الطلبات دفعة واحدة */
export const READ_CONCURRENCY = 12

async function getAllValues(ns: 'license' | 'services', keys: readonly string[]): Promise<(readonly [string, string | null])[]> {
  return mapLimit(keys, READ_CONCURRENCY, async (key) => {
    const r = await bridge.cf.get(ns, key)
    // قراءة فاشلة ≠ مفتاح فارغ: لو اعتبرناها فارغة لظهر العميل «بدون اشتراك» بلا ميزات،
    // ولو أُعيد إصداره من تلك الصورة لسُحبت أقسامه. نُفشل التحديث ونُبقي البيانات السابقة.
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

export const useDataStore = create<DataState>((set, get) => ({
  customers: [],
  loading: false,
  error: null,
  lastSyncAt: null,
  servicesAvailable: true,
  servicesError: null,
  chatOnly: [],
  warning: null,

  refresh: () => {
    // تحديث جارٍ؟ لا نتجاهل الطلب (كان يضيع تحديث ما بعد الإصدار) — نجدول تحديثاً واحداً بعده
    if (inflight) {
      queued ??= inflight.then(() => { queued = null; return get().refresh() })
      return queued
    }
    inflight = runRefresh(set, get).finally(() => { inflight = null })
    return inflight
  },
}))

let inflight: Promise<void> | null = null
let queued: Promise<void> | null = null

type SetState = (partial: Partial<DataState>) => void
async function runRefresh(set: SetState, get: () => DataState): Promise<void> {
  set({ loading: true, error: null })

  // بيانات التراخيص أساسية إلزامية؛ بيانات الخدمات (الدعم) اختيارية —
  // غياب مساحة الخدمات لا يجوز أن يُسقط شاشات التراخيص والعملاء.
  try {
    // ① القوائم + قائمة الحرق. لا نسرد lic: إطلاقاً: كل إعادة إصدار تضيف سجلاً وتُبقي القديم،
    //    فكانت قائمة lic: تتضخم وتُقصّ عند السقف — ومفاتيحها مرتّبة ببصمة عشوائية، فيسقط
    //    السجل «الحالي» لعملاء عشوائيين (بلا ميزات/أقسام، وإعادة إصدارهم تسحب أقسامهم).
    //    سرد chat: (مساحة الخدمات) بالتوازي أيضاً لكن فشله لا يُسقط شيئاً
    const [devList, logList, emailList, revokedRaw, chatListed] = await Promise.all([
      listAll('license', 'dev:'),
      listAll('license', 'log:'),
      listAll('license', 'email:'),
      bridge.cf.get('license', 'revoked'),
      listAll('services', 'chat:').then((list) => ({ list }), (e: unknown) => ({ error: e })),
    ])
    if (!revokedRaw.ok) throw Object.assign(new Error(`تعذر قراءة قائمة الحرق: ${revokedRaw.error ?? ''}`), { code: revokedRaw.code })

    // ② سجلات الأجهزة أولاً — منها نعرف البصمات الحالية فعلاً
    const devEntries = await getAllValues('license', devList.keys)
    const deviceIds = new Set(devEntries.map(([k]) => k.slice('dev:'.length)))
    const fingerprints = new Set<string>()
    for (const [, raw] of devEntries) {
      const fp = parseDevRecord(raw).fingerprint
      if (typeof fp === 'string' && fp) fingerprints.add(fp)
    }

    // ③ في طابور واحد (حد تزامن كلي واحد): سجل المفتاح الحالي لكل جهاز فقط + سجلات نشاط
    //    الأجهزة المعروفة + فهرس البريد
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

    // ④ مساحة الخدمات: تُقرأ منفصلة وبلا إسقاط للعملية كلها
    let chatEntries: (readonly [string, string | null])[] = []
    let servicesAvailable = true
    let servicesError: string | null = null
    let chatTruncated = false
    try {
      if ('error' in chatListed) throw chatListed.error
      chatTruncated = chatListed.list.truncated
      chatEntries = await getAllValues('services', chatListed.list.keys)
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

    const truncated = [
      devList.truncated && 'الأجهزة (dev:)',
      logList.truncated && 'سجلات النشاط (log:)',
      emailList.truncated && 'البريد (email:)',
      chatTruncated && 'محادثات الدعم (chat:)',
    ].filter(Boolean)
    const warning = truncated.length
      ? `تجاوز العدد ${MAX_KEYS_PER_PREFIX} في: ${truncated.join('، ')} — بعض السجلات لم تُعرض`
      : null

    const at = new Date().toISOString()
    set({ customers, chatOnly, warning, loading: false, lastSyncAt: at, servicesAvailable, servicesError })
    try {
      await bridge.db.cachePut('customers:snapshot', JSON.stringify({ at, customers }))
    } catch { /* cache is best-effort */ }
  } catch (e) {
    const code = (e as Error & { code?: string })?.code
    const message = e instanceof Error ? e.message : String(e)
    // مساحة الخدمات وحدها لا تُعطّل اللوحة — يُعرض تنبيه لطيف أعلى الشاشة
    if (code === 'ns_missing' && message.includes('الخدمات')) {
      set({ loading: false, servicesAvailable: false, servicesError: message, customers: get().customers, lastSyncAt: new Date().toISOString() })
      return
    }
    set({ loading: false, error: message })
  }
}
