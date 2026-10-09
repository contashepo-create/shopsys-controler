/**
 * الفحص السادس — اختبارات على الكود الحقيقي:
 *  • desktop/auth.cjs (يُحمَّل كما هو) — التحقق بالملح المخزّن، القفل، رمز الاستعادة
 *  • دوال main.cjs مستخرجة نصاً (الكتابة الذرّية، أكواد أخطاء Cloudflare، فحص مفتاح التوقيع…)
 *  • جسر سطح المكتب: { ok:false } لا تُعامل كنجاح
 *  • data.store: سجل الترخيص الحالي لا يضيع مهما كثرت سجلات lic: القديمة
 */
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import nodeCrypto from 'node:crypto'
import { hashPassword, type PasswordHash } from '../src/core/password.ts'
import { extractFunction, extractConst } from './helpers/desktopSigner.ts'

const require = createRequire(import.meta.url)
const appRoot = join(import.meta.dirname, '..')
const MAIN = readFileSync(join(appRoot, 'desktop', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n')
const PRELOAD = readFileSync(join(appRoot, 'desktop', 'preload.cjs'), 'utf8')
const BUILDER = readFileSync(join(appRoot, 'electron-builder.yml'), 'utf8')

type AuthApi = {
  hasPassword(): boolean
  isUnlocked(): boolean
  isAllowed(): boolean
  lock(): { ok: boolean }
  verify(pw: unknown): Promise<{ ok: boolean; code?: string; retryInMs?: number; attemptsLeft?: number }>
  setPassword(h: unknown): { ok: boolean; code?: string; error?: string }
  requestOtp(purpose?: string): Promise<{ ok: boolean; code?: string; error?: string; expiresAt?: number }>
  resetWithOtp(code: string, h: unknown): { ok: boolean; code?: string; attemptsLeft?: number; error?: string }
}
const authMod = require('../desktop/auth.cjs') as {
  createAuth(d: unknown): AuthApi
  isValidPasswordHash(h: unknown): boolean
  OTP_MAX_ATTEMPTS: number; MAX_FAILS: number; COOLDOWN_MS: number; OTP_TTL_MS: number; OTP_RESEND_MS: number
}

function makeAuth(initial: PasswordHash | null = null, opts: { send?: (t: string) => Promise<{ ok: boolean; error?: string }>; corrupt?: boolean } = {}) {
  const store = { value: initial as unknown, writes: 0 }
  const sent: string[] = []
  const clock = { t: 1_000_000 }
  const auth = authMod.createAuth({
    readAuth: () => { if (opts.corrupt) throw new Error('ملف تالف'); return store.value },
    writeAuth: (v: unknown) => { store.value = v; store.writes++ },
    sendTelegram: opts.send ?? (async (t: string) => { sent.push(t); return { ok: true } }),
    now: () => clock.t,
  })
  const lastCode = () => sent[sent.length - 1]?.match(/^\d{6}$/m)?.[0] ?? ''
  return { auth, store, sent, clock, lastCode }
}

const PW = 'كلمة-سر-قوية-123'

describe('auth.cjs — التحقق من كلمة المرور (كان يفشل دائماً، وكانت أي كلمة تفتح اللوحة)', () => {
  it('الكلمة الصحيحة تفتح (تجزئة الواجهة WebCrypto ⇄ تحقق Node بنفس الملح) والخاطئة تُرفض', async () => {
    const { auth } = makeAuth(await hashPassword(PW))
    expect(auth.isUnlocked()).toBe(false)
    expect(await auth.verify('كلمة-خاطئة-999')).toMatchObject({ ok: false, code: 'wrong' })
    expect(auth.isUnlocked()).toBe(false)
    expect(await auth.verify(PW)).toEqual({ ok: true })
    expect(auth.isUnlocked()).toBe(true)
  })

  it('تمرير «تجزئة» بدل الكلمة (العقد القديم) يُرفض — لا يقارن الملح العشوائي', async () => {
    const stored = await hashPassword(PW)
    const { auth } = makeAuth(stored)
    expect((await auth.verify(await hashPassword(PW) as unknown)).ok).toBe(false)
    expect((await auth.verify(stored as unknown)).ok).toBe(false)
    expect((await auth.verify('')).ok).toBe(false)
  })

  it('5 محاولات خاطئة ⇒ تهدئة 30 ثانية ترفض حتى الكلمة الصحيحة، ثم تعود', async () => {
    const { auth, clock } = makeAuth(await hashPassword(PW))
    for (let i = 1; i < authMod.MAX_FAILS; i++) expect(await auth.verify(`wrong-${i}-xxxx`)).toMatchObject({ code: 'wrong', attemptsLeft: authMod.MAX_FAILS - i })
    expect(await auth.verify('wrong-last-xxxx')).toMatchObject({ ok: false, code: 'cooldown' })
    expect(await auth.verify(PW)).toMatchObject({ ok: false, code: 'cooldown' })
    clock.t += authMod.COOLDOWN_MS + 1
    expect(await auth.verify(PW)).toEqual({ ok: true })
  })

  it('لا كلمة مرور ⇒ no_password، وملف تالف لا يُعامل «كأول تشغيل»', async () => {
    expect(await makeAuth(null).auth.verify(PW)).toMatchObject({ ok: false, code: 'no_password' })
    const corrupt = makeAuth(null, { corrupt: true })
    expect(corrupt.auth.hasPassword()).toBe(true)
    expect(corrupt.auth.isAllowed()).toBe(false)
    expect(corrupt.auth.setPassword(await hashPassword(PW))).toMatchObject({ ok: false, code: 'locked' })
  })
})

describe('auth.cjs — تعيين كلمة المرور وحالة القفل في العملية الرئيسية', () => {
  it('أول تشغيل: التعيين مسموح ويفتح الجلسة؛ بعدها مقفلة ⇒ مرفوض ولا يُكتب شيء؛ مفتوحة ⇒ مسموح', async () => {
    const { auth, store } = makeAuth(null)
    expect(auth.isAllowed()).toBe(true) // الإعداد الأول يحتاج الحفظ قبل وجود كلمة مرور
    expect(auth.setPassword(await hashPassword(PW))).toEqual({ ok: true })
    expect(auth.isUnlocked()).toBe(true)
    auth.lock()
    expect(auth.isAllowed()).toBe(false)
    const before = JSON.stringify(store.value)
    expect(auth.setPassword(await hashPassword('مهاجم-يغيّر-الكلمة'))).toMatchObject({ ok: false, code: 'locked' })
    expect(JSON.stringify(store.value)).toBe(before)
    expect((await auth.verify(PW)).ok).toBe(true)
    expect(auth.setPassword(await hashPassword('كلمة-جديدة-456'))).toEqual({ ok: true })
    auth.lock()
    expect((await auth.verify('كلمة-جديدة-456')).ok).toBe(true)
  })

  it('صيغة تجزئة غير صالحة تُرفض قبل أي كتابة', async () => {
    const { auth, store } = makeAuth(null)
    const good = await hashPassword(PW)
    for (const bad of [null, [], 'x', { ...good, hash: 'قصير' }, { ...good, iterations: 10 }, { ...good, salt: '' }, { salt: good.salt, hash: good.hash }]) {
      expect(auth.setPassword(bad)).toMatchObject({ ok: false, code: 'invalid' })
    }
    expect(store.writes).toBe(0)
    expect(authMod.isValidPasswordHash(good)).toBe(true)
  })
})

describe('auth.cjs — رمز الاستعادة يُولَّد ويُتحقق منه في العملية الرئيسية', () => {
  it('رمز صحيح يعيّن الكلمة الجديدة (والقديمة لم تعد تعمل)', async () => {
    const { auth, sent, lastCode } = makeAuth(await hashPassword(PW))
    const r = await auth.requestOtp('استعادة كلمة المرور')
    expect(r.ok).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('لا تشاركه مع أي أحد')
    expect(sent[0]).not.toMatch(/anyone/)
    expect(lastCode()).toMatch(/^\d{6}$/)
    expect(auth.resetWithOtp(lastCode(), await hashPassword('كلمة-مستعادة-1'))).toEqual({ ok: true })
    expect(auth.isUnlocked()).toBe(false) // الاستعادة لا تفتح اللوحة — يدخل بالكلمة الجديدة
    expect((await auth.verify(PW)).ok).toBe(false)
    expect((await auth.verify('كلمة-مستعادة-1')).ok).toBe(true)
  })

  it('صيغة كلمة غير صالحة لا تستهلك محاولة؛ 3 رموز خاطئة ⇒ يُلغى الرمز حتى الصحيح', async () => {
    const { auth, lastCode, store } = makeAuth(await hashPassword(PW))
    await auth.requestOtp()
    const code = lastCode()
    const wrong = code === '000000' ? '111111' : '000000'
    const h = await hashPassword('كلمة-مستعادة-2')
    expect(auth.resetWithOtp(code, { bad: true })).toMatchObject({ code: 'invalid' })
    expect(auth.resetWithOtp(wrong, h)).toMatchObject({ ok: false, code: 'wrong', attemptsLeft: 2 })
    expect(auth.resetWithOtp(wrong, h)).toMatchObject({ ok: false, code: 'wrong', attemptsLeft: 1 })
    expect(auth.resetWithOtp(wrong, h)).toMatchObject({ ok: false, code: 'locked' })
    expect(auth.resetWithOtp(code, h)).toMatchObject({ ok: false, code: 'no_otp' })
    expect(store.writes).toBe(0)
  })

  it('انتهاء الصلاحية، إعادة الإرسال السريعة، وفشل الإرسال لا يترك رمزاً صالحاً', async () => {
    const a = makeAuth(await hashPassword(PW))
    await a.auth.requestOtp()
    expect(await a.auth.requestOtp()).toMatchObject({ ok: false, code: 'too_soon' })
    a.clock.t += authMod.OTP_TTL_MS + 1
    expect(a.auth.resetWithOtp(a.lastCode(), await hashPassword('x-1234567'))).toMatchObject({ code: 'expired' })

    const b = makeAuth(await hashPassword(PW), { send: async () => ({ ok: false, error: 'Bad Request: chat not found' }) })
    expect(await b.auth.requestOtp()).toMatchObject({ ok: false, code: 'send_failed', error: 'Bad Request: chat not found' })
    expect(b.auth.resetWithOtp('123456', await hashPassword('x-1234567'))).toMatchObject({ code: 'no_otp' })
  })

  it('الرمز منتظم التوزيع (crypto.randomInt) — 6 أرقام دائماً، بما فيها البادئة صفر', async () => {
    const seen = new Set<string>()
    const stored = await hashPassword(PW)
    for (let i = 0; i < 40; i++) {
      const { auth, lastCode, clock } = makeAuth(stored)
      clock.t += i
      await auth.requestOtp()
      expect(lastCode()).toMatch(/^\d{6}$/)
      seen.add(lastCode())
    }
    expect(seen.size).toBeGreaterThan(35)
  })
})

describe('main.cjs — التوصيل', () => {
  const handlersBlock = MAIN.slice(MAIN.indexOf('const HANDLERS = {'), MAIN.indexOf('function registerIpc'))
  const handlerChannels = [...handlersBlock.matchAll(/^ {2}'([a-z]+:[A-Za-z]+)':/gm)].map((m) => m[1])
  const preloadChannels = [...PRELOAD.matchAll(/^ {2}'([a-z]+:[A-Za-z]+)',$/gm)].map((m) => m[1])

  it('كل قناة في main مصرّحة في العزل والعكس (قناة ناقصة = زر لا يعمل بصمت)', () => {
    expect(handlerChannels.length).toBeGreaterThan(20)
    expect([...preloadChannels].sort()).toEqual([...handlerChannels].sort())
    for (const ch of ['auth:lock', 'auth:requestOtp', 'auth:resetWithOtp']) expect(handlerChannels).toContain(ch)
  })

  it('القنوات الحساسة تُرفض واللوحة مقفلة — والفحص قبل استدعاء المعالج', () => {
    const reg = extractFunction('registerIpc')
    expect(reg.indexOf('LOCKED_CHANNELS.has(channel) && !auth.isAllowed()')).toBeGreaterThan(-1)
    expect(reg.indexOf('LOCKED_CHANNELS.has(channel)')).toBeLessThan(reg.indexOf('await fn(...args)'))
    const set = MAIN.slice(MAIN.indexOf('const LOCKED_CHANNELS'), MAIN.indexOf('])', MAIN.indexOf('const LOCKED_CHANNELS')))
    for (const ch of ['license:sign', 'secrets:set', 'cf:request', 'tg:send', 'db:auditList']) expect(set).toContain(`'${ch}'`)
    // قنوات شاشة القفل نفسها لا تُحجب
    for (const ch of ['auth:verifyPassword', 'auth:requestOtp', 'auth:resetWithOtp', 'secrets:status', 'setup:isComplete', 'profile:get']) expect(set).not.toContain(`'${ch}'`)
  })

  it('كل ملف desktop/*.cjs يطلبه main مُدرج في حزمة المثبّت', () => {
    const required = [...MAIN.matchAll(/require\('\.\/([\w.-]+\.cjs)'\)/g)].map((m) => m[1])
    expect(required).toContain('auth.cjs')
    for (const f of required) expect(BUILDER).toMatch(new RegExp(`^\\s*- desktop/${f.replace('.', '\\.')}\\s*$`, 'm'))
  })

  it('أدوات المطوّر معطلة في النسخة المثبّتة، والتنقل لـ localhost في التطوير فقط، وإعادة التحميل تقفل', () => {
    expect(MAIN).toMatch(/devTools:\s*isDev/)
    expect(MAIN).toMatch(/isDev && url\.startsWith\('http:\/\/localhost:'\)/)
    expect(MAIN).toMatch(/on\('did-navigate', \(\) => \{ auth\.lock\(\) \}\)/)
  })
})

describe('main.cjs — التخزين المحلي (ذرّي، والتالف يُحفظ جانباً)', () => {
  function storeFns(dir: string) {
    const src = [
      'let cfConfigCache = { cached: true }',
      "const SECRETS_FILE = 'secrets.enc.json'",
      extractFunction('jsonPath'), extractFunction('readJson'), extractFunction('readJsonForUpdate'), extractFunction('writeJson'),
      extractConst('isPlainObject'),
      'return { readJson, readJsonForUpdate, writeJson, isPlainObject, cache: () => cfConfigCache }',
    ].join('\n')
    return new Function('fs', 'path', 'userDir', 'process', 'console', src)(
      require('node:fs'), require('node:path'), () => dir, process, { warn: () => {} },
    ) as {
      readJson(n: string, fb: unknown): unknown
      readJsonForUpdate(n: string, fb: unknown, ok?: (v: unknown) => boolean): unknown
      writeJson(n: string, v: unknown): void
      isPlainObject(v: unknown): boolean
      cache(): unknown
    }
  }

  it('الكتابة لا تترك ملفات مؤقتة، وكتابة الأسرار/الإعداد تُبطل ذاكرة إعداد Cloudflare', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctl-'))
    const s = storeFns(dir)
    s.writeJson('profile.json', { name: 'م' })
    expect(s.cache()).not.toBeNull() // ملف لا علاقة له لا يُبطلها
    s.writeJson('config.json', { nsLicense: 'a' })
    expect(s.cache()).toBeNull()
    expect(s.readJson('config.json', null)).toEqual({ nsLicense: 'a' })
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('ملف تالف قبل تعديل: يُنسخ جانباً ثم البدء من الافتراضي (ولا يُمحى صامتاً)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctl-'))
    const s = storeFns(dir)
    writeFileSync(join(dir, 'secrets.enc.json'), '{"cfApiToken":"enc:AAA', 'utf8')
    expect(s.readJsonForUpdate('secrets.enc.json', {}, s.isPlainObject)).toEqual({})
    const backups = readdirSync(dir).filter((f) => f.startsWith('secrets.enc.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(dir, backups[0]), 'utf8')).toBe('{"cfApiToken":"enc:AAA')
    // مصفوفة بدل كائن = شكل خاطئ ⇒ نفس المعاملة
    writeFileSync(join(dir, 'audit.json'), '{"not":"array"}', 'utf8')
    expect(s.readJsonForUpdate('audit.json', [], Array.isArray)).toEqual([])
    // غير موجود ⇒ الافتراضي بلا نسخ
    expect(s.readJsonForUpdate('cache.json', {}, s.isPlainObject)).toEqual({})
    expect(existsSync(join(dir, 'cache.json'))).toBe(false)
  })
})

describe('main.cjs — Cloudflare والتدقيق ومفتاح التوقيع', () => {
  const cf = new Function(`${extractFunction('cfError')}\n${extractFunction('cfFail')}\n${extractFunction('isMissingKey404')}\nreturn { cfFail, isMissingKey404 }`)() as {
    cfFail(s: number, b: string): { ok: boolean; code: string; error: string }
    isMissingKey404(b: string): boolean
  }

  it('401/403 ⇒ code «auth»، غيرها ⇒ «cf_error» (كانت بلا كود)', () => {
    expect(cf.cfFail(403, '{}')).toMatchObject({ ok: false, code: 'auth' })
    expect(cf.cfFail(401, '')).toMatchObject({ code: 'auth' })
    expect(cf.cfFail(500, '')).toMatchObject({ code: 'cf_error' })
    expect(cf.cfFail(429, '')).toMatchObject({ code: 'cf_error' })
  })

  it('404 «مفتاح غير موجود» = null، أما 404 لمساحة/حساب خاطئ فخطأ وليس «فارغاً»', () => {
    expect(cf.isMissingKey404(JSON.stringify({ success: false, errors: [{ code: 10009, message: "get: 'key not found'" }] }))).toBe(true)
    expect(cf.isMissingKey404('')).toBe(true)
    expect(cf.isMissingKey404(JSON.stringify({ errors: [{ code: 7003, message: 'Could not route to /accounts/x/storage/kv/namespaces/y' }] }))).toBe(false)
    expect(cf.isMissingKey404(JSON.stringify({ errors: [{ code: 10013, message: 'namespace not found' }] }))).toBe(false)
  })

  it('تفاصيل التدقيق نص JSON صالح دائماً حتى عند القصّ', () => {
    const auditDetails = new Function(`${extractFunction('auditDetails')}\nreturn auditDetails`)() as (d: unknown) => string | null
    expect(auditDetails(null)).toBeNull()
    expect(auditDetails({ plan: 'pro' })).toBe('{"plan":"pro"}')
    const long = auditDetails({ note: 'ن'.repeat(5000) })!
    expect(long.length).toBeLessThanOrEqual(2000)
    expect(JSON.parse(long)).toMatchObject({ truncated: true })
  })

  function keyValidator(publicB64u: string) {
    return new Function('crypto', 'PUBLIC_KEY_B64U',
      `${extractConst('B64U')}\n${extractFunction('b64uToBuffer')}\n${extractFunction('bufferToB64u')}\n${extractFunction('validatePrivateKey')}\nreturn validatePrivateKey`,
    )(nodeCrypto, publicB64u) as (k: string) => string | null
  }
  const pair = () => {
    const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ed25519')
    const priv = (privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64url')
    const raw = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
    return { priv, pub: raw.subarray(raw.length - 32).toString('base64url') }
  }

  it('مفتاح خاص مطابق يُقبل، وغير المطابق/التالف/غير Ed25519 يُرفض قبل الحفظ', () => {
    const k = pair()
    const validate = keyValidator(k.pub)
    expect(validate(k.priv)).toBeNull()
    expect(validate(pair().priv)).toMatch(/لا يطابق المفتاح العام/)
    expect(validate('not-a-key')).toMatch(/غير صالح/)
    const rsa = (nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64url')
    expect(validate(rsa)).toMatch(/ليس Ed25519/)
  })

  it('handleSecretsSet يتحقق من المفتاح قبل أي setSecret', () => {
    const fn = extractFunction('handleSecretsSet')
    expect(fn.indexOf('validatePrivateKey(')).toBeGreaterThan(-1)
    expect(fn.indexOf('validatePrivateKey(')).toBeLessThan(fn.indexOf('setSecret('))
  })
})

describe('جسر سطح المكتب — نتيجة { ok:false } ليست نجاحاً', () => {
  async function desktopBridgeWith(responses: Record<string, unknown>) {
    vi.resetModules()
    const api: Record<string, unknown> = {}
    for (const [ch, res] of Object.entries(responses)) api[ch] = vi.fn(async () => res)
    ;(globalThis as { window?: unknown }).window = { controlerDesktop: api }
    try {
      const { bridge } = await import('../src/data/bridge.ts')
      return { bridge, api }
    } finally {
      delete (globalThis as { window?: unknown }).window
    }
  }

  it('verifyPassword: يمرّر الكلمة نفسها، و{ok:false} ⇒ ok:false (كانت كائناً «صحيحاً» يفتح اللوحة)', async () => {
    const { bridge, api } = await desktopBridgeWith({ 'auth:verifyPassword': { ok: false, code: 'wrong' } })
    expect(bridge.runtime).toBe('electron')
    const r = await bridge.auth.verifyPassword('pw')
    expect(r.ok).toBe(false)
    expect(api['auth:verifyPassword']).toHaveBeenCalledWith('pw')
    const ok = await desktopBridgeWith({ 'auth:verifyPassword': { ok: true } })
    expect(await ok.bridge.auth.verifyPassword('pw')).toEqual({ ok: true })
    for (const weird of [true, 1, 'ok', {}, null, undefined, { ok: 'true' }]) {
      const w = await desktopBridgeWith({ 'auth:verifyPassword': weird })
      expect((await w.bridge.auth.verifyPassword('pw')).ok).toBe(false)
    }
  })

  it('خطأ فعلي (ملف كلمة مرور تالف) يُرمى بدل «كلمة خاطئة»', async () => {
    const { bridge } = await desktopBridgeWith({ 'auth:verifyPassword': { ok: false, error: 'ملف كلمة المرور تالف' } })
    await expect(bridge.auth.verifyPassword('pw')).rejects.toThrow('تالف')
  })

  it('setPassword وsecrets.set يرميان عند الرفض (كانا يُعدّان نجاحاً)', async () => {
    const { bridge } = await desktopBridgeWith({
      'auth:setPassword': { ok: false, code: 'locked', error: 'اللوحة مقفلة' },
      'secrets:set': { ok: false, code: 'invalid_key', error: 'المفتاح الخاص لا يطابق' },
    })
    const h = await hashPassword(PW)
    await expect(bridge.auth.setPassword(h)).rejects.toThrow('اللوحة مقفلة')
    await expect(bridge.secrets.set({ privateKeyB64u: 'x' })).rejects.toThrow('لا يطابق')
  })
})

describe('جسر المتصفح — التحقق بالملح المخزّن', () => {
  it('الكلمة الصحيحة تُقبل بعد الحفظ والخاطئة تُرفض (كانت تقارن ملحاً عشوائياً فتفشل دائماً)', async () => {
    vi.resetModules()
    const mem = new Map<string, string>()
    vi.stubGlobal('window', {}) // بلا controlerDesktop ⇒ جسر المتصفح
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) }, removeItem: (k: string) => { mem.delete(k) } })
    try {
      const { bridge } = await import('../src/data/bridge.ts')
      expect(bridge.runtime).toBe('web')
      expect(await bridge.auth.verifyPassword(PW)).toMatchObject({ ok: false, code: 'no_password' })
      await bridge.auth.setPassword(await hashPassword(PW))
      expect(await bridge.auth.verifyPassword(PW)).toEqual({ ok: true })
      expect((await bridge.auth.verifyPassword('خطأ-123456')).ok).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
