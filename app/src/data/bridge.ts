/**
 * Bridge between the renderer and the Electron main process.
 * The main process owns every secret (Cloudflare token, bot token, private key,
 * password hash) — the renderer only sees results and masked status flags.
 * A localStorage-backed web fallback keeps `npm run dev` usable in a browser
 * (profile/auth/audit work; Cloudflare/Telegram/signing require the desktop app).
 */

import type { KvNamespace } from '../core/kv.ts'
import { verifyPassword as verifyStoredPassword, type PasswordHash } from '../core/password.ts'
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
export type CfErrorCode = 'ns_missing' | 'no_token' | 'no_account' | 'auth' | 'cf_error' | 'locked'

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

/* ─── التحديث التلقائي ─── */

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'latest' | 'error' | 'unsupported'

export interface UpdateState {
  status: UpdateStatus
  version: string | null
  percent: number
  error: string | null
  currentVersion: string
}

export interface UpdateAction {
  ok: boolean
  error?: string
}

/** معلومات بيانات المالك المحفوظة على الجهاز (لا تُمسّ عند التحديث) */
export interface DataInfo {
  path: string
  backupsPath: string
  backups: number
  lastBackupAt: string | null
}

export interface AuthVerifyResult {
  ok: boolean
  /** wrong = كلمة خاطئة · cooldown = محاولات كثيرة (انتظر retryInMs) · no_password = لم تُنشأ بعد */
  code?: 'wrong' | 'cooldown' | 'no_password'
  retryInMs?: number
  attemptsLeft?: number
}

export interface OtpRequestResult {
  ok: boolean
  expiresAt?: number
  maxAttempts?: number
  code?: string
  error?: string
}

export interface OtpResetResult {
  ok: boolean
  code?: 'invalid' | 'no_otp' | 'expired' | 'locked' | 'wrong'
  attemptsLeft?: number
  error?: string
}

/** نتيجة IPC → نجاح فقط إن كانت ok === true حرفياً (كائن { ok:false } «صحيح» في JS). */
function isOk(r: unknown): r is { ok: true } {
  return typeof r === 'object' && r !== null && (r as { ok?: unknown }).ok === true
}

function errorOf(r: unknown, fallback: string): string {
  const e = typeof r === 'object' && r !== null ? (r as { error?: unknown }).error : undefined
  return typeof e === 'string' && e ? e : fallback
}

export interface ControlerBridge {
  runtime: 'electron' | 'web'
  app: {
    version(): Promise<string>
    dataInfo(): Promise<DataInfo>
    openDataFolder(): Promise<{ ok: boolean; error?: string }>
    snapshotData(): Promise<{ created: boolean; at?: string; error?: string }>
  }
  setup: { isComplete(): Promise<{ hasProfile: boolean; hasPassword: boolean }> }
  profile: { get(): Promise<DeveloperProfile | null>; save(p: DeveloperProfile): Promise<void> }
  auth: {
    /** يرمي عند الرفض (صيغة غير صالحة، أو اللوحة مقفلة وتوجد كلمة مرور) */
    setPassword(h: PasswordHash): Promise<void>
    /** كلمة المرور نفسها — التحقق بالملح المخزّن يتم في العملية الرئيسية */
    verifyPassword(password: string): Promise<AuthVerifyResult>
    lock(): Promise<void>
    /** يولّد رمز الاستعادة ويرسله لتليجرام من العملية الرئيسية (الرمز لا يمر بالواجهة) */
    requestOtp(purposeAr: string): Promise<OtpRequestResult>
    resetWithOtp(code: string, h: PasswordHash): Promise<OtpResetResult>
  }
  /** set يرمي عند الرفض (مثل مفتاح توقيع لا يطابق المفتاح العام) */
  secrets: { status(): Promise<SecretsStatus>; set(p: SecretsPatch): Promise<void> }
  cf: {
    listKeys(ns: KvNamespace, prefix?: string, cursor?: string): Promise<CfListResult>
    get(ns: KvNamespace, key: string): Promise<CfGetResult>
    put(ns: KvNamespace, key: string, value: string, metadata?: Record<string, unknown>): Promise<CfWriteResult>
    delete(ns: KvNamespace, key: string): Promise<CfWriteResult>
    test(): Promise<{ ok: boolean; error?: string }>
    namespaces(): Promise<CfNamespacesResult>
    createNamespace(title: string): Promise<CfNamespaceCreateResult>
  }
  tg: { send(text: string): Promise<TgSendResult>; getMe(): Promise<TgMeResult> }
  license: { sign(payloadJson: string): Promise<LicenseSignResult>; checkKey(): Promise<LicenseCheckResult> }
  updates: {
    state(): Promise<UpdateState>
    check(): Promise<UpdateAction>
    download(): Promise<UpdateAction>
    install(): Promise<UpdateAction>
    /** يشترك في بثّ الحالة الحيّ — يعيد دالة إلغاء الاشتراك */
    onState(cb: (s: UpdateState) => void): () => void
  }
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
    app: {
      version: async () => '0.1.0-web',
      dataInfo: async () => ({ path: '—', backupsPath: '—', backups: 0, lastBackupAt: null }),
      openDataFolder: async () => notDesktop(),
      snapshotData: async () => notDesktop(),
    },
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
      verifyPassword: async (password) => {
        const stored = read<PasswordHash | null>('controler:password', null)
        if (!stored || typeof stored.salt !== 'string' || typeof stored.hash !== 'string') return { ok: false, code: 'no_password' }
        // يُعاد الاشتقاق بالملح المخزّن (التجزئة بملح جديد لا تطابق أبداً)
        return (await verifyStoredPassword(password, stored)) ? { ok: true } : { ok: false, code: 'wrong' }
      },
      lock: async () => {},
      requestOtp: async () => ({ ok: false, error: DESKTOP_ONLY }),
      resetWithOtp: async () => ({ ok: false, error: DESKTOP_ONLY }),
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
    updates: {
      state: async () => ({ status: 'unsupported', version: null, percent: 0, error: 'التحديث التلقائي في نسخة سطح المكتب فقط', currentVersion: '0.0.0' }),
      check: async () => notDesktop(),
      download: async () => notDesktop(),
      install: async () => notDesktop(),
      onState: () => () => {},
    },
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
    app: {
      version: () => invoke<string>('app:version'),
      dataInfo: () => invoke('app:dataInfo'),
      openDataFolder: () => invoke('app:openDataFolder'),
      snapshotData: () => invoke('app:snapshotData'),
    },
    setup: { isComplete: () => invoke('setup:isComplete') },
    profile: { get: () => invoke('profile:get'), save: (p) => invoke('profile:save', p) },
    auth: {
      setPassword: async (h) => {
        const r = await invoke<unknown>('auth:setPassword', h)
        if (!isOk(r)) throw new Error(errorOf(r, 'تعذر حفظ كلمة المرور'))
      },
      verifyPassword: async (password) => {
        const r = await invoke<unknown>('auth:verifyPassword', password)
        if (isOk(r)) return { ok: true }
        const o = (typeof r === 'object' && r !== null ? r : {}) as AuthVerifyResult & { error?: string }
        if (o.error && !o.code) throw new Error(o.error) // خطأ فعلي (مثل ملف كلمة مرور تالف) — ليس «كلمة خاطئة»
        return { ok: false, code: o.code ?? 'wrong', retryInMs: o.retryInMs, attemptsLeft: o.attemptsLeft }
      },
      lock: async () => { await invoke('auth:lock') },
      requestOtp: async (purposeAr) => {
        const r = await invoke<unknown>('auth:requestOtp', purposeAr)
        return isOk(r) ? (r as OtpRequestResult) : { ...(r as object), ok: false, error: errorOf(r, 'تعذر إرسال الرمز') }
      },
      resetWithOtp: async (code, h) => {
        const r = await invoke<unknown>('auth:resetWithOtp', code, h)
        return isOk(r) ? { ok: true } : { ...(r as object), ok: false, error: errorOf(r, 'تعذر تعيين كلمة المرور') }
      },
    },
    secrets: {
      status: () => invoke('secrets:status'),
      set: async (p) => {
        const r = await invoke<unknown>('secrets:set', p)
        if (!isOk(r)) throw new Error(errorOf(r, 'تعذر حفظ الإعدادات'))
      },
    },
    cf: {
      listKeys: (ns, prefix, cursor) => invoke('cf:request', { ns, op: 'listKeys', prefix, cursor }),
      get: (ns, key) => invoke('cf:request', { ns, op: 'get', key }),
      put: (ns, key, value, metadata) => invoke('cf:request', { ns, op: 'put', key, value, ...(metadata ? { metadata } : {}) }),
      delete: (ns, key) => invoke('cf:request', { ns, op: 'delete', key }),
      test: () => invoke('cf:test'),
      namespaces: () => invoke('cf:namespaces'),
      createNamespace: (title) => invoke('cf:namespaceCreate', title),
    },
    tg: { send: (text) => invoke('tg:send', text), getMe: () => invoke('tg:getMe') },
    updates: {
      state: () => invoke('update:state'),
      check: () => invoke('update:check'),
      download: () => invoke('update:download'),
      install: () => invoke('update:install'),
      onState: (cb) => {
        const subscribe = (window.controlerDesktop as unknown as { onUpdateState?: (fn: (s: UpdateState) => void) => () => void })?.onUpdateState
        return typeof subscribe === 'function' ? subscribe(cb) : () => {}
      },
    },
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
