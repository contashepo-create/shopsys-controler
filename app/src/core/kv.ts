/**
 * Cloudflare KV REST API client — pure core (fetch is injectable for tests).
 * The API token never lives in the renderer: the Electron main process owns it
 * and performs the HTTP calls; this module only builds/parses requests.
 * User-facing errors are Arabic (short, ready to display).
 */

export type KvNamespace = 'license' | 'services'

export interface KvNamespaceConfig {
  accountId: string
  apiToken: string
  namespaces: Record<KvNamespace, string>
}

export interface KvListResult {
  keys: string[]
  cursor: string | null
}

export type KvErrorCode = 'ns_missing' | 'no_token' | 'no_account' | 'auth' | 'cf_error'

export class KvError extends Error {
  status: number
  code: KvErrorCode
  constructor(message: string, status: number, code: KvErrorCode = 'cf_error') {
    super(message)
    this.name = 'KvError'
    this.status = status
    this.code = code
  }
}

export interface KvClient {
  listKeys(ns: KvNamespace, prefix?: string, cursor?: string): Promise<KvListResult>
  get(ns: KvNamespace, key: string): Promise<string | null>
  put(ns: KvNamespace, key: string, value: string): Promise<void>
  delete(ns: KvNamespace, key: string): Promise<void>
}

const CF_API_BASE = 'https://api.cloudflare.com/client/v4'

function namespaceUrl(cfg: KvNamespaceConfig, ns: KvNamespace, key?: string): string {
  const nsId = cfg.namespaces[ns]
  if (!nsId) {
    throw new KvError(
      ns === 'license'
        ? 'مساحة التراخيص (SHOPSYS_CONTROL) غير مضبوطة — الإعدادات ← Cloudflare'
        : 'مساحة الخدمات (SHOPSYS_KV) غير مضبوطة — الإعدادات ← Cloudflare',
      0,
      'ns_missing',
    )
  }
  const base = `${CF_API_BASE}/accounts/${cfg.accountId}/storage/kv/namespaces/${nsId}`
  return key == null ? base : `${base}/values/${encodeURIComponent(key)}`
}

function errorFromStatus(status: number): string {
  if (status === 401 || status === 403) return 'مفتاح Cloudflare غير صالح أو密度 الصلاحيات'
  if (status === 404) return 'الحساب أو namespace غير موجود — تحقق من المعرفات'
  if (status === 429) return 'تجاوزت حد طلبات Cloudflare — حاول بعد لحظات'
  if (status >= 500) return 'تعذر الوصول إلى Cloudflare — تحقق من الاتصال'
  return `فشل الطلب (${status})`
}

interface Envelope {
  success: boolean
  result: unknown
  errors: { message?: string }[]
  result_info?: { cursor?: string }
}

function messageFor(status: number, apiMessage?: string): string {
  // 401/403/404/429/5xx ⇒ رسالة عربية أوضح من نص Cloudflare الخام
  if (status === 401 || status === 403 || status === 404 || status === 429 || status >= 500) return errorFromStatus(status)
  return apiMessage || errorFromStatus(status)
}

async function parseEnvelope(res: Response): Promise<Envelope> {
  const text = await res.text()
  try {
    return JSON.parse(text) as Envelope
  } catch {
    throw new KvError(errorFromStatus(res.status), res.status)
  }
}

/** Create a KV client. fetchImpl is injectable for tests. */
export function createKvClient(cfg: KvNamespaceConfig, fetchImpl: typeof fetch = fetch): KvClient {
  const headers = () => ({
    authorization: `Bearer ${cfg.apiToken}`,
    'content-type': 'application/json; charset=utf-8',
  })

  return {
    async listKeys(ns, prefix, cursor) {
      const params = new URLSearchParams()
      if (prefix) params.set('prefix', prefix)
      params.set('limit', '1000')
      if (cursor) params.set('cursor', cursor)
      const res = await fetchImpl(`${namespaceUrl(cfg, ns)}/keys?${params.toString()}`, { headers: headers() })
      const env = await parseEnvelope(res)
      if (!res.ok || !env.success) throw new KvError(messageFor(res.status, env.errors?.[0]?.message), res.status)
      const result = (env.result ?? []) as { name: string }[]
      const next = env.result_info?.cursor && env.result_info.cursor !== '' ? env.result_info.cursor : null
      return { keys: result.map((k) => k.name), cursor: next }
    },

    async get(ns, key) {
      const res = await fetchImpl(namespaceUrl(cfg, ns, key), { headers: headers() })
      if (res.status === 404) return null
      if (!res.ok) {
        const env = await parseEnvelope(res).catch(() => null)
        throw new KvError(messageFor(res.status, env?.errors?.[0]?.message), res.status)
      }
      return res.text()
    },

    async put(ns, key, value) {
      const res = await fetchImpl(namespaceUrl(cfg, ns, key), {
        method: 'PUT',
        headers: { ...headers(), 'content-type': 'text/plain; charset=utf-8' },
        body: value,
      })
      const env = await parseEnvelope(res)
      if (!res.ok || !env.success) throw new KvError(messageFor(res.status, env.errors?.[0]?.message), res.status)
    },

    async delete(ns, key) {
      const res = await fetchImpl(namespaceUrl(cfg, ns, key), { method: 'DELETE', headers: headers() })
      if (res.status === 404) return
      const env = await parseEnvelope(res)
      if (!res.ok || !env.success) throw new KvError(messageFor(res.status, env.errors?.[0]?.message), res.status)
    },
  }
}

/** List every key with a prefix, following pagination cursors. */
export async function listAllKeys(client: KvClient, ns: KvNamespace, prefix?: string): Promise<string[]> {
  const all: string[] = []
  let cursor: string | null = null
  do {
    const page = await client.listKeys(ns, prefix, cursor ?? undefined)
    all.push(...page.keys)
    cursor = page.cursor
  } while (cursor)
  return all
}
