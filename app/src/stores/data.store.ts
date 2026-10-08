import { create } from 'zustand'
import { bridge } from '../data/bridge.ts'
import { buildCustomerViews, type CustomerView } from '../core/customers.ts'

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

async function getAllValues(ns: 'license' | 'services', keys: readonly string[]): Promise<(readonly [string, string | null])[]> {
  const capped = keys.slice(0, MAX_KEYS_PER_PREFIX)
  const results = await Promise.all(capped.map(async (key) => {
    const r = await bridge.cf.get(ns, key)
    return [key, r.ok ? r.value : null] as const
  }))
  return results
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

  refresh: async () => {
    if (get().loading) return
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
      // مساحة الخدمات: تُقرأ منفصلة وبلا إسقاط للعملية كلها
      let chatKeys: string[] = []
      let chatEntries: (readonly [string, string | null])[] = []
      let servicesAvailable = true
      let servicesError: string | null = null
      try {
        chatKeys = await listAll('services', 'chat:')
        chatEntries = await getAllValues('services', chatKeys)
      } catch (e) {
        servicesAvailable = false
        servicesError = e instanceof Error ? e.message : String(e)
      }

      const [devEntries, licEntries, logEntries, emailEntries] = await Promise.all([
        getAllValues('license', devKeys),
        getAllValues('license', licKeys),
        getAllValues('license', logKeys),
        getAllValues('license', emailKeys),
      ])
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
  },
}))
