import { create } from 'zustand'
import { bridge } from '../data/bridge.ts'
import { buildCustomerViews, type CustomerView } from '../core/customers.ts'

interface DataState {
  customers: CustomerView[]
  loading: boolean
  error: string | null
  lastSyncAt: string | null
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
    if (!page.ok) throw new Error(page.error ?? 'تعذر قراءة Cloudflare')
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

  refresh: async () => {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      const [devKeys, licKeys, logKeys, emailKeys, chatKeys, revokedRaw] = await Promise.all([
        listAll('license', 'dev:'),
        listAll('license', 'lic:'),
        listAll('license', 'log:'),
        listAll('license', 'email:'),
        listAll('services', 'chat:'),
        bridge.cf.get('license', 'revoked'),
      ])
      const [devEntries, licEntries, logEntries, emailEntries, chatEntries] = await Promise.all([
        getAllValues('license', devKeys),
        getAllValues('license', licKeys),
        getAllValues('license', logKeys),
        getAllValues('license', emailKeys),
        getAllValues('services', chatKeys),
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
      set({ customers, loading: false, lastSyncAt: at })
      try {
        await bridge.db.cachePut('customers:snapshot', JSON.stringify({ at, customers }))
      } catch { /* cache is best-effort */ }
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },
}))
