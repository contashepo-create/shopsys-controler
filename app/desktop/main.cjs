/**
 * Electron main process — owns EVERY secret and every network call that needs one.
 *
 *   · Cloudflare API token  → encrypted at rest (safeStorage/DPAPI), used here only
 *   · Bot token             → same
 *   · Ed25519 private key   → same; signing happens here, the key never reaches the renderer
 *   · Password hash/salt    → local JSON in userData (no native module needed)
 *   · Audit log             → local SQLite, append-only, no secrets
 *
 * The renderer gets results and masked flags only (see preload.cjs).
 */
const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

/* ───────────────────────── local store ───────────────────────── */


const userDir = () => app.getPath('userData')

function jsonPath(name) {
  return path.join(userDir(), name)
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(jsonPath(name), 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(name, value) {
  fs.mkdirSync(userDir(), { recursive: true })
  fs.writeFileSync(jsonPath(name), JSON.stringify(value), 'utf8')
}

/* ───────────────────────── secrets (encrypted at rest) ───────────────────────── */

const SECRETS_FILE = 'secrets.enc.json'

function encryptSecret(plain) {
  if (!plain) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(plain).toString('base64')
  }
  // fallback (portable/CI) — obfuscation only; the app warns the user in Settings
  return 'plain:' + Buffer.from(plain, 'utf8').toString('base64')
}

function decryptSecret(stored) {
  if (!stored) return ''
  try {
    if (stored.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    }
    if (stored.startsWith('plain:')) {
      return Buffer.from(stored.slice(6), 'base64').toString('utf8')
    }
  } catch (e) {
    console.warn('[controler] فشل فك تشفير سر مخزّن:', e.message)
  }
  return ''
}

function readSecretsRaw() {
  return readJson(SECRETS_FILE, {})
}

function setSecret(name, value) {
  const all = readSecretsRaw()
  if (value === undefined || value === null || value === '') delete all[name]
  else all[name] = encryptSecret(String(value))
  writeJson(SECRETS_FILE, all)
}

function getSecret(name) {
  const all = readSecretsRaw()
  return decryptSecret(all[name])
}

/* ───────────────────────── Cloudflare KV proxy ───────────────────────── */

const CF_BASE = 'https://api.cloudflare.com/client/v4'

function cfConfig() {
  return {
    token: getSecret('cfApiToken'),
    accountId: (getSecret('cfAccountId') || readJson('config.json', {}).cfAccountId || '').trim(),
    nsLicense: (readJson('config.json', {}).nsLicense || '').trim(),
    nsServices: (readJson('config.json', {}).nsServices || '').trim(),
  }
}

function nsIdFor(ns) {
  const cfg = cfConfig()
  return ns === 'services' ? cfg.nsServices : cfg.nsLicense
}

function cfHeaders() {
  const cfg = cfConfig()
  return {
    authorization: `Bearer ${cfg.token}`,
    'content-type': 'application/json; charset=utf-8',
  }
}

function cfError(status, body) {
  let detail = ''
  try { detail = JSON.parse(body)?.errors?.[0]?.message ?? '' } catch { /* keep empty */ }
  if (status === 401 || status === 403) return detail || 'توكن Cloudflare مرفوض أو بلا صلاحية KV'
  if (status === 404) return detail || 'الحساب أو namespace غير موجود'
  if (status === 429) return 'تجاوزت حد طلبات Cloudflare'
  if (status >= 500) return 'خدمة Cloudflare غير متاحة مؤقتاً'
  return detail || `فشل الطلب (${status})`
}

async function handleCfRequest(payload) {
  const { ns, op } = payload || {}
  const cfg = cfConfig()
  if (!cfg.token) return { ok: false, code: 'no_token', error: 'لم يُضبط توكن Cloudflare بعد (الإعدادات ← Cloudflare)' }
  if (!cfg.accountId) return { ok: false, code: 'no_account', error: 'لم يُضبط Account ID بعد (الإعدادات ← Cloudflare)' }
  const nsId = nsIdFor(ns)
  if (!nsId) {
    return {
      ok: false,
      code: 'ns_missing',
      error: ns === 'services'
        ? 'مساحة الخدمات (SHOPSYS_KV) غير مضبوطة — افتح الإعدادات ← Cloudflare واضبطها'
        : 'مساحة التراخيص (SHOPSYS_CONTROL) غير مضبوطة — افتح الإعدادات ← Cloudflare',
    }
  }

  const base = `${CF_BASE}/accounts/${cfg.accountId}/storage/kv/namespaces/${nsId}`
  const headers = cfHeaders()

  try {
    if (op === 'listKeys') {
      const params = new URLSearchParams()
      if (payload.prefix) params.set('prefix', String(payload.prefix))
      params.set('limit', '1000')
      if (payload.cursor) params.set('cursor', String(payload.cursor))
      const res = await fetch(`${base}/keys?${params}`, { headers })
      const text = await res.text()
      if (!res.ok) return { ok: false, error: cfError(res.status, text) }
      const env = JSON.parse(text)
      if (!env.success) return { ok: false, error: env.errors?.[0]?.message ?? 'فشل سرد المفاتيح' }
      return { ok: true, keys: (env.result ?? []).map((k) => k.name), cursor: env.result_info?.cursor || null }
    }

    if (op === 'get') {
      const res = await fetch(`${base}/values/${encodeURIComponent(payload.key)}`, { headers })
      if (res.status === 404) return { ok: true, value: null }
      const text = await res.text()
      if (!res.ok) return { ok: false, error: cfError(res.status, text) }
      return { ok: true, value: text }
    }

    if (op === 'put') {
      const res = await fetch(`${base}/values/${encodeURIComponent(payload.key)}`, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' },
        body: String(payload.value ?? ''),
      })
      const text = await res.text()
      if (!res.ok) return { ok: false, error: cfError(res.status, text) }
      try {
        const env = JSON.parse(text)
        if (!env.success) return { ok: false, error: env.errors?.[0]?.message ?? 'فشل الحفظ' }
      } catch { /* older API returns empty body */ }
      return { ok: true }
    }

    if (op === 'delete') {
      const res = await fetch(`${base}/values/${encodeURIComponent(payload.key)}`, { method: 'DELETE', headers })
      if (res.status === 404) return { ok: true }
      const text = await res.text()
      if (!res.ok) return { ok: false, error: cfError(res.status, text) }
      return { ok: true }
    }

    return { ok: false, error: 'عملية غير معروفة' }
  } catch (e) {
    return { ok: false, error: `تعذر الاتصال بـ Cloudflare: ${e.message}` }
  }
}

/** قائمة كل مساحات KV في الحساب — للاكتشاف والتوثيق الذاتي */
async function handleCfNamespaces() {
  const cfg = cfConfig()
  if (!cfg.token) return { ok: false, code: 'no_token', error: 'اضبط توكن Cloudflare أولاً' }
  if (!cfg.accountId) return { ok: false, code: 'no_account', error: 'اضبط Account ID أولاً' }
  try {
    const all = []
    let page = 1
    for (;;) {
      const res = await fetch(`${CF_BASE}/accounts/${cfg.accountId}/storage/kv/namespaces?per_page=100&page=${page}`, { headers: cfHeaders() })
      const text = await res.text()
      if (!res.ok) return { ok: false, code: 'cf_error', error: cfError(res.status, text) }
      const env = JSON.parse(text)
      if (!env.success) return { ok: false, code: 'cf_error', error: env.errors?.[0]?.message ?? 'فشل سرد المساحات' }
      const batch = env.result ?? []
      all.push(...batch.map((n) => ({ id: n.id, title: n.title })))
      const info = env.result_info ?? {}
      if (!info.page || info.page >= info.total_pages || batch.length === 0) break
      page += 1
      if (page > 20) break
    }
    return { ok: true, namespaces: all, accountId: cfg.accountId }
  } catch (e) {
    return { ok: false, code: 'cf_error', error: `تعذر الاتصال بـ Cloudflare: ${e.message}` }
  }
}

/** إنشاء مساحة KV جديدة (يتطلب توكن بصلاحية KV: Edit على مستوى الحساب) */
async function handleCfNamespaceCreate(title) {
  const cfg = cfConfig()
  if (!cfg.token) return { ok: false, code: 'no_token', error: 'اضبط توكن Cloudflare أولاً' }
  if (!cfg.accountId) return { ok: false, code: 'no_account', error: 'اضبط Account ID أولاً' }
  const clean = String(title ?? '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 60)
  if (clean.length < 3) return { ok: false, code: 'cf_error', error: 'اسم المساحة قصير جداً' }
  try {
    const res = await fetch(`${CF_BASE}/accounts/${cfg.accountId}/storage/kv/namespaces`, {
      method: 'POST',
      headers: cfHeaders(),
      body: JSON.stringify({ title: clean }),
    })
    const text = await res.text()
    if (!res.ok) {
      const env = JSON.parse(text || '{}')
      const detail = env.errors?.[0]?.message ?? ''
      return { ok: false, code: 'cf_error', error: detail ? `${detail} — يحتاج التوكن صلاحية Workers KV Storage: Edit` : cfError(res.status, text) }
    }
    const env = JSON.parse(text)
    if (!env.success) return { ok: false, code: 'cf_error', error: env.errors?.[0]?.message ?? 'فشل الإنشاء' }
    return { ok: true, id: env.result?.id, title: env.result?.title }
  } catch (e) {
    return { ok: false, code: 'cf_error', error: `تعذر الإنشاء: ${e.message}` }
  }
}

async function handleCfTest() {
  const cfg = cfConfig()
  if (!cfg.token || !cfg.accountId) return { ok: false, error: 'أكمل Account ID و API Token أولاً' }
  try {
    const res = await fetch(`${CF_BASE}/accounts/${cfg.accountId}/storage/kv/namespaces?per_page=5`, { headers: cfHeaders() })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: cfError(res.status, text) }
    const env = JSON.parse(text)
    if (!env.success) return { ok: false, error: env.errors?.[0]?.message ?? 'فشل الاتصال' }
    const ids = (env.result ?? []).map((n) => n.id)
    const missing = []
    if (cfg.nsLicense && !ids.includes(cfg.nsLicense)) missing.push('الترخيص')
    if (cfg.nsServices && !ids.includes(cfg.nsServices)) missing.push('الخدمات')
    if (missing.length) return { ok: false, error: `التوكن يعمل لكن namespace (${missing.join('، ')}) لا يظهر — تحقق من المعرّف` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `تعذر الاتصال: ${e.message}` }
  }
}

/* ───────────────────────── Telegram (dev bot) ───────────────────────── */

function tgToken() { return getSecret('botToken') }
function tgChatId() { return getSecret('adminChatId') }

async function handleTgSend(text) {
  const token = tgToken()
  const chatId = tgChatId()
  if (!token) return { ok: false, error: 'لم يُضبط توكن البوت بعد' }
  if (!chatId) return { ok: false, error: 'لم يُضبط معرّف محادثة المطوّر بعد' }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4000) }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok !== true) return { ok: false, error: data.description ?? `فشل الإرسال (${res.status})` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

async function handleTgGetMe() {
  const token = tgToken()
  if (!token) return { ok: false, error: 'لا يوجد توكن محفوظ' }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok !== true) return { ok: false, error: data.description ?? 'توكن غير صالح' }
    return { ok: true, username: data.result?.username, firstName: data.result?.first_name }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/* ───────────────────────── license signing (Ed25519, local) ───────────────────────── */

const PUBLIC_KEY_B64U = 'mOugSh8oJdc5H6nB9mMTNQYjyXzYle2RJepQkob3msE'
const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function b64uToBuffer(s) {
  const clean = String(s).replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(clean + '='.repeat((4 - (clean.length % 4)) % 4), 'base64')
}

function bufferToB64u(buf) {
  let out = ''
  for (let i = 0; i < buf.length; i += 3) {
    const b0 = buf[i]
    const b1 = i + 1 < buf.length ? buf[i + 1] : 0
    const b2 = i + 2 < buf.length ? buf[i + 2] : 0
    out += B64U[b0 >> 2]
    out += B64U[((b0 & 3) << 4) | (b1 >> 4)]
    if (i + 1 < buf.length) out += B64U[((b1 & 15) << 2) | (b2 >> 6)]
    if (i + 2 < buf.length) out += B64U[b2 & 63]
  }
  return out
}

/** Build a KeyObject from the stored pkcs8 base64url private key. */
function privateKeyObject() {
  const raw = getSecret('privateKeyB64u')
  if (!raw) return null
  return crypto.createPrivateKey({ key: b64uToBuffer(raw), format: 'der', type: 'pkcs8' })
}

/** Public key derived from the stored private key (raw 32 bytes) → base64url. */
function publicFromPrivate() {
  try {
    const priv = privateKeyObject()
    if (!priv) return null
    const pub = crypto.createPublicKey(priv)
    const raw = pub.export({ format: 'der', type: 'spki' })
    return bufferToB64u(raw.subarray(raw.length - 32))
  } catch (e) {
    console.warn('[controler] تعذر اشتقاق المفتاح العام:', e.message)
    return null
  }
}

/** Canonical payload — MUST match app/src/core/license.ts field order. */
function canonicalPayload(p) {
  const base = {
    v: p.v, deviceId: p.deviceId, customer: p.customer, plan: p.plan,
    features: [...p.features].sort(), issuedAt: p.issuedAt, expiresAt: p.expiresAt,
  }
  if (p.extraUsers != null) base.extraUsers = p.extraUsers
  if (p.extraBranches != null) base.extraBranches = p.extraBranches
  if (p.activityId != null) base.activityId = p.activityId
  if (p.extraModules != null) base.extraModules = [...p.extraModules].sort()
  return JSON.stringify(base)
}

function handleLicenseSign(payloadJson) {
  const priv = privateKeyObject()
  if (!priv) return { ok: false, error: 'المفتاح الخاص غير مستورد — الإعدادات ← مفتاح التوقيع' }
  try {
    const payload = JSON.parse(payloadJson)
    if (payload.v !== 1 || !payload.deviceId || !payload.plan) return { ok: false, error: 'حمولة غير مكتملة' }
    const msg = Buffer.from(canonicalPayload(payload), 'utf8')
    const sig = crypto.sign(null, msg, priv) // Ed25519
    const key = `SHOPSYS1.${bufferToB64u(msg)}.${bufferToB64u(sig)}`
    return { ok: true, key }
  } catch (e) {
    return { ok: false, error: `تعذر التوقيع: ${e.message}` }
  }
}

function handleLicenseCheck() {
  const pub = publicFromPrivate()
  if (pub == null) return { present: false, matchesPublic: false }
  return { present: true, matchesPublic: pub === PUBLIC_KEY_B64U }
}

/* ───────────────────────── settings plumbing ───────────────────────── */

function handleSecretsSet(patch) {
  const p = patch || {}
  if ('cfApiToken' in p) setSecret('cfApiToken', p.cfApiToken)
  if ('botToken' in p) setSecret('botToken', p.botToken)
  if ('adminChatId' in p) setSecret('adminChatId', p.adminChatId)
  if ('privateKeyB64u' in p) setSecret('privateKeyB64u', p.privateKeyB64u)
  const cfg = readJson('config.json', {})
  if ('cfAccountId' in p) cfg.cfAccountId = String(p.cfAccountId || '')
  if ('cfNsLicense' in p) cfg.nsLicense = String(p.cfNsLicense || '')
  if ('cfNsServices' in p) cfg.nsServices = String(p.cfNsServices || '')
  writeJson('config.json', cfg)
  return { ok: true }
}

function handleSecretsStatus() {
  const cfg = readJson('config.json', {})
  const keyInfo = handleLicenseCheck()
  return {
    hasCfToken: Boolean(getSecret('cfApiToken')),
    hasBotToken: Boolean(getSecret('botToken')),
    hasPrivateKey: keyInfo.present,
    publicKeyMatches: keyInfo.matchesPublic,
    cfAccountId: cfg.cfAccountId || '',
    cfNsLicense: cfg.nsLicense || '',
    cfNsServices: cfg.nsServices || '',
    adminChatId: getSecret('adminChatId'),
  }
}

/* ───────────────────────── password & profile ───────────────────────── */

function handleAuthSetPassword(hash) {
  writeJson('auth.json', hash)
  return { ok: true }
}

function handleAuthVerify(hash) {
  const stored = readJson('auth.json', null)
  if (!stored) return { ok: false }
  const eq = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
  }
  return { ok: eq(stored.hash, hash?.hash) && eq(stored.salt, hash?.salt) }
}

/* ───────────────── بيانات المالك: لقطات تلقائية (لا تُمسّ عند التحديث) ───────────────── */

/**
 * كل ما يخصّ المالك محفوظ في مجلد userData (لا يُلمس عند تثبيت تحديث فوق القديم):
 *   profile.json (الاسم/الهاتف/البريد) · auth.json (كلمة المرور مُهشَّرة)
 *   config.json (الربط والإعدادات) · secrets.enc.json (مفاتيح Cloudflare/البوت/التوقيع مُشفَّرة)
 *   audit.json · cache.json
 * التأمين الإضافي: لقطة دورية داخل userData/config-backups/<وقت>/ تُحفظ آخر 6 لقطات،
 * وتُؤخذ فقط عند تغيّر البيانات فعلاً — بلا أي إرسال للخارج (كلها على جهازك).
 */
const DATA_FILES = ['profile.json', 'auth.json', 'config.json', 'secrets.enc.json', 'audit.json', 'cache.json']
const MAX_SNAPSHOTS = 6

function dataFingerprint() {
  const h = crypto.createHash('sha256')
  for (const f of DATA_FILES) {
    try {
      h.update(f).update(':').update(fs.readFileSync(jsonPath(f))).update('|')
    } catch { /* لم يُنشأ الملف بعد */ }
  }
  return h.digest('hex').slice(0, 16)
}

function snapshotData(force = false) {
  try {
    const root = path.join(userDir(), 'config-backups')
    fs.mkdirSync(root, { recursive: true })
    const stateFile = path.join(root, 'state.json')
    let prev = null
    try { prev = JSON.parse(fs.readFileSync(stateFile, 'utf8')) } catch { /* أول مرة */ }

    const fingerprint = dataFingerprint()
    if (!force && prev && prev.fingerprint === fingerprint && prev.at) {
      return { created: false, fingerprint, at: prev.at }
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const box = path.join(root, stamp)
    fs.mkdirSync(box, { recursive: true })
    let copied = 0
    for (const f of DATA_FILES) {
      try { fs.copyFileSync(jsonPath(f), path.join(box, f)); copied++ } catch { /* غير موجود */ }
    }
    fs.writeFileSync(stateFile, JSON.stringify({ fingerprint, at: stamp, copied }), 'utf8')

    const boxes = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name).sort()
    for (const old of boxes.slice(0, Math.max(0, boxes.length - MAX_SNAPSHOTS))) {
      fs.rmSync(path.join(root, old), { recursive: true, force: true })
    }
    return { created: true, fingerprint, at: stamp, copied }
  } catch (e) {
    console.warn('[controler] تعذّر أخذ لقطة بيانات:', e.message)
    return { created: false, error: e.message }
  }
}

function dataInfo() {
  const root = path.join(userDir(), 'config-backups')
  let state = null
  let count = 0
  try { state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8')) } catch { /* لا لقطات */ }
  try { count = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).length } catch { /* لا مجلد */ }
  return { path: userDir(), backupsPath: root, backups: count, lastBackupAt: state?.at ?? null }
}

/* ───────────────────────── التحديث التلقائي (GitHub Releases) ───────────────────────── */

/**
 * يعمل في النسخة المثبّتة فقط (تحتاج resources/app-update.yml المولَّد من electron-builder).
 *
 * الوجهة: رف الإصدارات العام `shopsys-controler-updater` — **مستودع بلا أي كود**
 * (إصدارات فقط)؛ لهذا القراءة بلا توكن، وكود اللوحة يبقى في المستودع الخاص.
 *
 * السلوك (طلب المالك): التنزيل **في الخلفية** بلا إزعاج، والتثبيت **عند إغلاق التطبيق**.
 * وبيانات المالك (المفاتيح وكلمة المرور) في userData لا تُمسّ — فوق ذلك لقطة نسخ
 * احتياطية دورية في userData/config-backups (انظر snapshotData).
 */
let mainWindow = null
let autoUpdaterRef = null

let updateState = {
  status: 'idle',          // idle | checking | available | downloading | ready | latest | error | unsupported
  version: null,
  percent: 0,
  error: null,
  currentVersion: app.getVersion(),
}

function pushUpdateState(patch) {
  updateState = { ...updateState, ...patch }
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:state', updateState)
  } catch { /* النافذة أُغلقت */ }
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    updateState.status = 'unsupported'
    updateState.error = 'فحص التحديثات يعمل في النسخة المثبّتة فقط'
    return
  }
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdaterRef = autoUpdater
    autoUpdater.autoDownload = true        // طلب المالك: التنزيل في الخلفية تلقائياً
    autoUpdater.autoInstallOnAppQuit = true // وتركيب التحديث عند إغلاق اللوحة
    autoUpdater.allowDowngrade = false      // لا رجوع لإصدار أقدم
    autoUpdater.allowPrerelease = false     // الإصدارات المستقرة فقط
    autoUpdater.logger = null

    autoUpdater.on('checking-for-update', () => pushUpdateState({ status: 'checking', error: null }))
    autoUpdater.on('update-available', (info) => pushUpdateState({ status: 'available', version: info?.version ?? null, error: null }))
    autoUpdater.on('update-not-available', (info) => pushUpdateState({ status: 'latest', version: info?.version ?? app.getVersion(), percent: 0, error: null }))
    autoUpdater.on('download-progress', (p) => pushUpdateState({ status: 'downloading', percent: Math.round(Number(p?.percent ?? 0)) }))
    autoUpdater.on('update-downloaded', (info) => pushUpdateState({ status: 'ready', version: info?.version ?? null, percent: 100, error: null }))
    autoUpdater.on('error', (err) => pushUpdateState({ status: 'error', error: String(err?.message || err).slice(0, 300) }))

    // فحص صامت بعد الإقلاع بـ 12 ثانية (لا يزعج أول تشغيل)، ثم كل 6 ساعات
    setTimeout(() => { void autoUpdater.checkForUpdates().catch(() => {}) }, 12_000)
    setInterval(() => { void autoUpdater.checkForUpdates().catch(() => {}) }, 6 * 60 * 60 * 1000)
  } catch (e) {
    console.warn('[controler] electron-updater غير متاح:', e.message)
    updateState.status = 'unsupported'
    updateState.error = 'وحدة التحديث غير متاحة في هذه النسخة'
  }
}

/* ───────────────────────── IPC wiring ───────────────────────── */

const HANDLERS = {
  'app:version': () => app.getVersion(),
  'app:dataInfo': () => dataInfo(),
  'app:openDataFolder': async () => {
    const r = await shell.openPath(userDir())
    return r ? { ok: false, error: r } : { ok: true }
  },
  'app:snapshotData': () => snapshotData(true),
  'update:state': () => updateState,
  'update:check': async () => {
    if (!app.isPackaged) return { ok: false, error: 'فحص التحديثات يعمل في النسخة المثبّتة فقط' }
    if (!autoUpdaterRef) return { ok: false, error: 'وحدة التحديث غير متاحة' }
    try {
      pushUpdateState({ status: 'checking', error: null })
      await autoUpdaterRef.checkForUpdates()
      return { ok: true }
    } catch (e) {
      pushUpdateState({ status: 'error', error: e.message })
      return { ok: false, error: e.message }
    }
  },
  'update:download': async () => {
    if (!autoUpdaterRef) return { ok: false, error: 'وحدة التحديث غير متاحة' }
    try {
      pushUpdateState({ status: 'downloading', percent: 0, error: null })
      await autoUpdaterRef.downloadUpdate()
      return { ok: true }
    } catch (e) {
      pushUpdateState({ status: 'error', error: e.message })
      return { ok: false, error: e.message }
    }
  },
  'update:install': () => {
    if (!autoUpdaterRef) return { ok: false, error: 'وحدة التحديث غير متاحة' }
    // isSilent=false (يُظهر شاشة التثبيت)، isForceRunAfter=true (يعيد تشغيل اللوحة بعدها)
    setImmediate(() => autoUpdaterRef.quitAndInstall(false, true))
    return { ok: true }
  },
  'setup:isComplete': () => ({
    hasProfile: Boolean(readJson('profile.json', null)?.name),
    hasPassword: Boolean(readJson('auth.json', null)?.hash),
  }),
  'profile:get': () => readJson('profile.json', null),
  'profile:save': (p) => {
    writeJson('profile.json', {
      name: String(p?.name ?? '').slice(0, 80),
      phone: String(p?.phone ?? '').slice(0, 30),
      email: String(p?.email ?? '').slice(0, 120),
    })
    return { ok: true }
  },
  'auth:setPassword': (h) => handleAuthSetPassword(h),
  'auth:verifyPassword': (h) => handleAuthVerify(h),
  'secrets:status': () => handleSecretsStatus(),
  'secrets:set': (p) => handleSecretsSet(p),
  'cf:request': (p) => handleCfRequest(p),
  'cf:test': () => handleCfTest(),
  'cf:namespaces': () => handleCfNamespaces(),
  'cf:namespaceCreate': (title) => handleCfNamespaceCreate(title),
  'tg:send': (t) => handleTgSend(t),
  'tg:getMe': () => handleTgGetMe(),
  'license:sign': (j) => handleLicenseSign(j),
  'license:checkKey': () => handleLicenseCheck(),
  'db:auditAppend': (e) => {
    const row = {
      action: String(e?.action ?? '').slice(0, 60),
      target: e?.target != null ? String(e.target).slice(0, 120) : null,
      details: e?.details ? JSON.stringify(e.details).slice(0, 2000) : null,
      at: String(e?.at ?? new Date().toISOString()),
    }
    const list = readJson('audit.json', [])
    list.push(row)
    // سقف 5000 سطر — يكفي سنوات استخدام ويُبقي الملف صغيراً
    const trimmed = list.length > 5000 ? list.slice(list.length - 5000) : list
    writeJson('audit.json', trimmed)
    return { ok: true }
  },
  'db:auditList': (limit) => {
    const n = Math.min(Math.max(Number(limit) || 200, 1), 1000)
    const list = readJson('audit.json', [])
    return list.slice(-n).reverse().map((row, i) => ({ id: list.length - i, ...row }))
  },
  'db:cacheGet': (key) => {
    const cache = readJson('cache.json', {})
    return cache[String(key)] ?? null
  },
  'db:cachePut': (key, value) => {
    const cache = readJson('cache.json', {})
    cache[String(key)] = String(value)
    writeJson('cache.json', cache)
    return { ok: true }
  },
  'shell:openExternal': (url) => {
    const u = String(url)
    if (/^https:\/\//.test(u)) void shell.openExternal(u)
    return { ok: true }
  },
}

function registerIpc() {
  for (const [channel, fn] of Object.entries(HANDLERS)) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn(...args)
      } catch (e) {
        console.error(`[controler] ${channel}:`, e)
        return { ok: false, error: e.message }
      }
    })
  }
}

/* ───────────────────────── window ───────────────────────── */

const isDev = !app.isPackaged

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    title: 'مركز تحكم المطور — Shopsys Controler',
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.CONTROLER_DEV_URL
  if (isDev && devUrl) {
    void win.loadURL(devUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
  mainWindow = win
  win.on('closed', () => { if (mainWindow === win) mainWindow = null })
  return win
}

app.whenReady().then(() => {
  registerIpc()
  snapshotData()      // تأمين بيانات المالك قبل أي شيء (لا يعطّل الإقلاع عند الفشل)
  setupAutoUpdater()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// harden: never allow navigation away from the local app
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('http://localhost:') || url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })
})
