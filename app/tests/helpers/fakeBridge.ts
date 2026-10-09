/**
 * جسر وهمي كامل في الذاكرة — يحاكي Cloudflare KV (مساحتا license وservices) مع:
 *  • تقسيم listKeys إلى صفحات بمؤشر cursor (مثل Cloudflare)
 *  • حقن أخطاء لمفاتيح/مساحات محددة
 *  • قياس أقصى عدد طلبات متزامنة (لفحص حد الطلبات)
 *  • التوقيع بالموقِّع الحقيقي من main.cjs
 */
import type { ControlerBridge, CfErrorCode } from '../../src/data/bridge.ts'
import type { AuditEntry } from '../../src/core/audit.ts'
import { createDesktopSigner, type TestSigner } from './desktopSigner.ts'

type Ns = 'license' | 'services'

export interface FakeBridge {
  bridge: ControlerBridge
  kv: Record<Ns, Map<string, string>>
  audit: AuditEntry[]
  signer: TestSigner
  stats: { gets: number; puts: number; lists: number; maxInFlight: number }
  /** مساحة غير مضبوطة (ns_missing) */
  missingNs: Set<Ns>
  /** أعطال كتابة: `${ns}:${key}` */
  failPut: Set<string>
  /** فشل التوقيع (المفتاح الخاص غير مستورد) */
  signFails: boolean
  pageSize: number
  /** تأخير اصطناعي لكل طلب (ms) — ليظهر التزامن */
  latencyMs: number
  reset(): void
  json<T = unknown>(ns: Ns, key: string): T | null
  seed(ns: Ns, key: string, value: unknown): void
}

export function createFakeBridge(): FakeBridge {
  let inFlight = 0
  const f: FakeBridge = {
    bridge: null as unknown as ControlerBridge,
    kv: { license: new Map(), services: new Map() },
    audit: [],
    signer: createDesktopSigner(),
    stats: { gets: 0, puts: 0, lists: 0, maxInFlight: 0 },
    missingNs: new Set(),
    failPut: new Set(),
    signFails: false,
    pageSize: 1000,
    latencyMs: 0,
    reset() {
      f.kv.license.clear(); f.kv.services.clear(); f.audit.length = 0
      f.stats = { gets: 0, puts: 0, lists: 0, maxInFlight: 0 }
      f.missingNs.clear(); f.failPut.clear(); f.signFails = false; f.pageSize = 1000; f.latencyMs = 0
    },
    json<T>(ns: Ns, key: string): T | null {
      const raw = f.kv[ns].get(key)
      return raw == null ? null : JSON.parse(raw) as T
    },
    seed(ns, key, value) { f.kv[ns].set(key, typeof value === 'string' ? value : JSON.stringify(value)) },
  }

  const track = async <T>(fn: () => T): Promise<T> => {
    inFlight++
    f.stats.maxInFlight = Math.max(f.stats.maxInFlight, inFlight)
    try {
      if (f.latencyMs) await new Promise((r) => setTimeout(r, f.latencyMs))
      return fn()
    } finally { inFlight-- }
  }
  const missing = (ns: Ns) => (f.missingNs.has(ns) ? { ok: false, error: 'مساحة غير مضبوطة', code: 'ns_missing' as CfErrorCode } : null)

  const notUsed = async (): Promise<never> => { throw new Error('غير مستخدم في الاختبار') }

  f.bridge = {
    runtime: 'electron',
    app: { version: async () => 'test', dataInfo: notUsed, openDataFolder: notUsed, snapshotData: notUsed },
    setup: { isComplete: async () => ({ hasProfile: true, hasPassword: true }) },
    profile: { get: async () => null, save: async () => {} },
    auth: { setPassword: async () => {}, verifyPassword: async () => true },
    secrets: { status: notUsed, set: notUsed },
    cf: {
      listKeys: (ns, prefix = '', cursor) => track(() => {
        f.stats.lists++
        const m = missing(ns); if (m) return { ...m, keys: [], cursor: null }
        const all = [...f.kv[ns].keys()].filter((k) => k.startsWith(prefix)).sort()
        const start = cursor ? Number(cursor) : 0
        const keys = all.slice(start, start + f.pageSize)
        const next = start + f.pageSize < all.length ? String(start + f.pageSize) : null
        return { ok: true, keys, cursor: next }
      }),
      get: (ns, key) => track(() => {
        f.stats.gets++
        const m = missing(ns); if (m) return { ...m, value: null }
        return { ok: true, value: f.kv[ns].get(key) ?? null }
      }),
      put: (ns, key, value) => track(() => {
        f.stats.puts++
        const m = missing(ns); if (m) return m
        if (f.failPut.has(`${ns}:${key}`)) return { ok: false, error: `فشل كتابة ${key}`, code: 'cf_error' as CfErrorCode }
        f.kv[ns].set(key, value)
        return { ok: true }
      }),
      delete: (ns, key) => track(() => { f.kv[ns].delete(key); return { ok: true } }),
      test: async () => ({ ok: true }),
      namespaces: notUsed,
      createNamespace: notUsed,
    },
    tg: { send: async () => ({ ok: true }), getMe: async () => ({ ok: true, username: 'bot' }) },
    license: {
      sign: async (json) => (f.signFails ? { ok: false, error: 'المفتاح الخاص غير مستورد' } : f.signer.sign(json)),
      checkKey: async () => ({ present: true, matchesPublic: true }),
    },
    updates: { state: notUsed, check: notUsed, download: notUsed, install: notUsed, onState: () => () => {} },
    db: {
      auditAppend: async (e) => { f.audit.push(e) },
      auditList: async () => [],
      cacheGet: async () => null,
      cachePut: async () => {},
    },
  }
  return f
}
