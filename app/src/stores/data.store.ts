import { create } from 'zustand'
import { bridge } from '../data/bridge.ts'
import { buildCustomerViews, type CustomerView } from '../core/customers.ts'
import { mapLimit } from '../core/concurrency.ts'

interface DataState {
  customers: CustomerView[]
  loading: boolean
  error: string | null
  lastSyncAt: string | null
  /** مساحة الخدمات (الدعم/الأعلام/الاشتراكات/التحديثات) متاحة؟ */
  servicesAvailable: boolean
  servicesError: string | null
  refresh(): Promise<void>
}

const MAX_KEYS_PER_PREFIX = 2000
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

async function listAll(ns: 'license' | 'services', prefix: string): Promise<string[]> {
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
  return all
}

export const useDataStore = create<DataState>((set, get) => ({
  customers: [],
  loading: false,
  error: null,
  lastSyncAt: null,
  servicesAvailable: true,
  servicesError: null,

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
    const [devKeys, licKeys, logKeys, emailKeys, revokedRaw] = await Promise.all([
      listAll('license', 'dev:'),
      listAll('license', 'lic:'),
      listAll('license', 'log:'),
      listAll('license', 'email:'),
      bridge.cf.get('license', 'revoked'),
    ])
    if (!revokedRaw.ok) throw Object.assign(new Error(`تعذر قراءة قائمة الحرق: ${revokedRaw.error ?? ''}`), { code: revokedRaw.code })
    // مساحة الخدمات: تُقرأ منفصلة وبلا إسقاط للعملية كلها
    let chatKeys: string[] = []
    let chatEntries: (readonly [string, string | null])[] = []
    let servicesAvailable = true
    let servicesError: string | null = null
    try {
      chatKeys = await listAll('services', 'chat:')
      chatEntries = await getAllValues('services', chatKeys.slice(0, MAX_KEYS_PER_PREFIX))
    } catch (e) {
      servicesAvailable = false
      servicesError = e instanceof Error ? e.message : String(e)
    }

    // قراءة كل البادئات في طابور واحد — الحد الكلي للتزامن READ_CONCURRENCY وليس لكل بادئة
    const capped = [devKeys, licKeys, logKeys, emailKeys].map((keys) => keys.slice(0, MAX_KEYS_PER_PREFIX))
    const values = await getAllValues('license', capped.flat())
    const bounds = capped.reduce<number[]>((acc, keys) => [...acc, acc[acc.length - 1] + keys.length], [0])
    const [devEntries, licEntries, logEntries, emailEntries] = capped.map((_, i) => values.slice(bounds[i], bounds[i + 1]))
    let revoked: string[] = []
    try { revoked = revokedRaw.ok && revokedRaw.value ? JSON.parse(revokedRaw.value) as string[] : [] } catch { revoked = [] }
    if (!Array.isArray(revoked)) revoked = []

    const strip = (prefix: string) => (entries: readonly (readonly [string, string | null])[]) =>
      entries.map(([k, v]) => [k.slice(prefix.length), v] as const)

    const customers = buildCustomerViews({
      devEntries: strip('dev:')(devEntries),
      licEntries: strip('lic:')(licEntries),
      logEntries: strip('log:')(logEntries),
      emailEntries: emailEntries.map(([k, v]) => [k.slice('email:'.length), v] as const),
      chatEntries: strip('chat:')(chatEntries),
      revoked,
      todayIso: new Date().toISOString().slice(0, 10),
    })
    const at = new Date().toISOString()
    set({ customers, loading: false, lastSyncAt: at, servicesAvailable, servicesError })
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
