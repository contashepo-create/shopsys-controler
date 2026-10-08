/**
 * Bridge between the renderer and the Electron main process.
 * The main process owns every secret (Cloudflare token, bot token, private key,
 * password hash) — the renderer only sees results and masked status flags.
 * A localStorage-backed web fallback keeps `npm run dev` usable in a browser
 * (profile/auth/audit work; Cloudflare/Telegram/signing require the desktop app).
 */

import type { KvNamespace } from '../core/kv.ts'
import type { PasswordHash } from '../core/password.ts'
import type { AuditEntry } from '../core/audit.ts'
import type { DeveloperProfile } from '../core/settings.ts'

export interface SecretsStatus {
  hasCfToken: boolean
  hasBotToken: boolean
  hasPrivateKey: boolean
  publicKeyMatches: boolean
  cfAccountId: string
  cfNsLicense: string
  cfNsServices: string
  adminChatId: string
}

export interface SecretsPatch {
  cfApiToken?: string
  botToken?: string
  adminChatId?: string
  privateKeyB64u?: string
  cfAccountId?: string
  cfNsLicense?: string
  cfNsServices?: string
}

/** رموز أخطاء موحّدة بين العملية الرئيسية والواجهة */
export type CfErrorCode = 'ns_missing' | 'no_token' | 'no_account' | 'auth' | 'cf_error'

export interface CfListResult {
  ok: boolean
  keys: string[]
  cursor: string | null
  error?: string
  code?: CfErrorCode
}

export interface CfGetResult {
  ok: boolean
  value: string | null
  error?: string
  code?: CfErrorCode
}

export interface CfWriteResult {
  ok: boolean
  error?: string
  code?: CfErrorCode
}

export interface CfNamespaceInfo {
  id: string
  title: string
}

export interface CfNamespacesResult {
  ok: boolean
  namespaces: CfNamespaceInfo[]
  accountId?: string
  error?: string
  code?: CfErrorCode
}

export interface CfNamespaceCreateResult {
  ok: boolean
  id?: string
  title?: string
  error?: string
  code?: CfErrorCode
}

export interface TgSendResult {
  ok: boolean
  error?: string
}

export interface TgMeResult {
  ok: boolean
  username?: string
  firstName?: string
  error?: string
}

export interface LicenseSignResult {
  ok: boolean
  key?: string
  error?: string
}

export interface LicenseCheckResult {
  present: boolean
  matchesPublic: boolean
}

export interface AuditRow extends AuditEntry {
  id: number
}

export interface ControlerBridge {
  runtime: 'electron' | 'web'
  app: { version(): Promise<string> }
  setup: { isComplete(): Promise<{ hasProfile: boolean; hasPassword: boolean }> }
  profile: { get(): Promise<DeveloperProfile | null>; save(p: DeveloperProfile): Promise<void> }
  auth: { setPassword(h: PasswordHash): Promise<void>; verifyPassword(h: PasswordHash): Promise<boolean> }
  secrets: { status(): Promise<SecretsStatus>; set(p: SecretsPatch): Promise<void> }
  cf: {
    listKeys(ns: KvNamespace, prefix?: string, cursor?: string): Promise<CfListResult>
    get(ns: KvNamespace, key: string): Promise<CfGetResult>
    put(ns: KvNamespace, key: string, value: string): Promise<CfWriteResult>
    delete(ns: KvNamespace, key: string): Promise<CfWriteResult>
    test(): Promise<{ ok: boolean; error?: string }>
    namespaces(): Promise<CfNamespacesResult>
    createNamespace(title: string): Promise<CfNamespaceCreateResult>
  }
  tg: { send(text: string): Promise<TgSendResult>; getMe(): Promise<TgMeResult> }
  license: { sign(payloadJson: string): Promise<LicenseSignResult>; checkKey(): Promise<LicenseCheckResult> }
  db: {
    auditAppend(e: AuditEntry): Promise<void>
    auditList(limit: number): Promise<AuditRow[]>
    cacheGet(key: string): Promise<string | null>
    cachePut(key: string, value: string): Promise<void>
  }
}

const DESKTOP_ONLY = 'متاح في نسخة سطح المكتب فقط — شغّل التطبيق عبر Electron'

/* ─── Web fallback (browser dev) ─── */

function webBridge(): ControlerBridge {
  const read = <T>(k: string, fb: T): T => {
    try {
      const raw = localStorage.getItem(k)
      return raw ? (JSON.parse(raw) as T) : fb
    } catch {
      return fb
    }
  }
  const write = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
  const notDesktop = (): never => {
    throw new Error(DESKTOP_ONLY)
  }
  return {
    runtime: 'web',
    app: { version: async () => '0.1.0-web' },
    setup: {
      isComplete: async () => ({
        hasProfile: read<DeveloperProfile | null>('controler:profile', null) != null,
        hasPassword: read<PasswordHash | null>('controler:password', null) != null,
      }),
    },
    profile: {
      get: async () => read<DeveloperProfile | null>('controler:profile', null),
      save: async (p) => write('controler:profile', p),
    },
    auth: {
      setPassword: async (h) => write('controler:password', h),
      verifyPassword: async (h) => {
        const stored = read<PasswordHash | null>('controler:password', null)
        if (!stored) return false
        // comparison only — the web fallback never sees the plain password
        return stored.salt === h.salt && stored.hash === h.hash && stored.iterations === h.iterations
      },
    },
    secrets: {
      status: async () => ({
        hasCfToken: false, hasBotToken: false, hasPrivateKey: false, publicKeyMatches: false,
        cfAccountId: '', cfNsLicense: '', cfNsServices: '', adminChatId: '',
      }),
      set: async () => notDesktop(),
    },
    cf: {
      listKeys: async () => notDesktop(),
      get: async () => notDesktop(),
      put: async () => notDesktop(),
      delete: async () => notDesktop(),
      test: async () => notDesktop(),
        namespaces: async () => notDesktop(),
        createNamespace: async () => notDesktop(),
    },
    tg: { send: async () => notDesktop(), getMe: async () => notDesktop() },
    license: { sign: async () => notDesktop(), checkKey: async () => notDesktop() },
    db: {
      auditAppend: async (e) => {
        const list = read<AuditEntry[]>('controler:audit', [])
        list.push(e)
        write('controler:audit', list.slice(-500))
      },
      auditList: async (limit) => read<AuditEntry[]>('controler:audit', []).slice(-limit).reverse().map((e, i) => ({ id: i, ...e })),
      cacheGet: async (k) => localStorage.getItem(`controler:cache:${k}`),
      cachePut: async (k, v) => localStorage.setItem(`controler:cache:${k}`, v),
    },
  }
}

function desktopBridge(): ControlerBridge | null {
  const w = window.controlerDesktop
  if (!w || typeof w !== 'object') return null
  const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
    (w[channel] as (...a: unknown[]) => Promise<unknown>)(...args) as Promise<T>
  return {
    runtime: 'electron',
    app: { version: () => invoke<string>('app:version') },
    setup: { isComplete: () => invoke('setup:isComplete') },
    profile: { get: () => invoke('profile:get'), save: (p) => invoke('profile:save', p) },
    auth: { setPassword: (h) => invoke('auth:setPassword', h), verifyPassword: (h) => invoke('auth:verifyPassword', h) },
    secrets: { status: () => invoke('secrets:status'), set: (p) => invoke('secrets:set', p) },
    cf: {
      listKeys: (ns, prefix, cursor) => invoke('cf:request', { ns, op: 'listKeys', prefix, cursor }),
      get: (ns, key) => invoke('cf:request', { ns, op: 'get', key }),
      put: (ns, key, value) => invoke('cf:request', { ns, op: 'put', key, value }),
      delete: (ns, key) => invoke('cf:request', { ns, op: 'delete', key }),
      test: () => invoke('cf:test'),
      namespaces: () => invoke('cf:namespaces'),
      createNamespace: (title) => invoke('cf:namespaceCreate', title),
    },
    tg: { send: (text) => invoke('tg:send', text), getMe: () => invoke('tg:getMe') },
    license: { sign: (payloadJson) => invoke('license:sign', payloadJson), checkKey: () => invoke('license:checkKey') },
    db: {
      auditAppend: (e) => invoke('db:auditAppend', e),
      auditList: (limit) => invoke('db:auditList', limit),
      cacheGet: (k) => invoke('db:cacheGet', k),
      cachePut: (k, v) => invoke('db:cachePut', k, v),
    },
  }
}

export const bridge: ControlerBridge = desktopBridge() ?? webBridge()

export function isDesktop(): boolean {
  return bridge.runtime === 'electron'
}

export function requireDesktop(): void {
  if (!isDesktop()) throw new Error(DESKTOP_ONLY)
}
