/**
 * Electron main process — owns EVERY secret and every network call that needs one.
 *
 *   · Cloudflare API token  → encrypted at rest (safeStorage/DPAPI), used here only
 *   · Bot token             → same
 *   · Ed25519 private key   → same; signing happens here, the key never reaches the renderer
 *   · Password hash/salt    → local SQLite (better-sqlite3) in userData
 *   · Audit log             → local SQLite, append-only, no secrets
 *
 * The renderer gets results and masked flags only (see preload.cjs).
 */
const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

/* ───────────────────────── local store ───────────────────────── */

let Database = null
try {
  Database = require('better-sqlite3')
} catch (e) {
  console.warn('[controler] better-sqlite3 غير متاح — سيُستخدم تخزين JSON:', e.message)
}

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

let db = null
function getDb() {
  if (db) return db
  if (!Database) return null
  fs.mkdirSync(userDir(), { recursive: true })
  db = new Database(path.join(userDir(), 'controler.db'))
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target TEXT,
      details TEXT,
      at TEXT NOT NULL
    );
  `)
  return db
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
  if (!cfg.token) return { ok: false, error: 'لم يُضبط توكن Cloudflare بعد (الإعدادات)' }
  if (!cfg.accountId) return { ok: false, error: 'لم يُضبط Account ID بعد (الإعدادات)' }
  const nsId = nsIdFor(ns)
  if (!nsId) return { ok: false, error: ns === 'services' ? 'namespace الخدمات غير مضبوط' : 'namespace الترخيص غير مضبوط' }

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

/* ───────────────────────── IPC wiring ───────────────────────── */

const HANDLERS = {
  'app:version': () => app.getVersion(),
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
  'tg:send': (t) => handleTgSend(t),
  'tg:getMe': () => handleTgGetMe(),
  'license:sign': (j) => handleLicenseSign(j),
  'license:checkKey': () => handleLicenseCheck(),
  'db:auditAppend': (e) => {
    const database = getDb()
    const row = {
      action: String(e?.action ?? '').slice(0, 60),
      target: e?.target != null ? String(e.target).slice(0, 120) : null,
      details: e?.details ? JSON.stringify(e.details).slice(0, 2000) : null,
      at: String(e?.at ?? new Date().toISOString()),
    }
    if (database) database.prepare('INSERT INTO audit (action, target, details, at) VALUES (?, ?, ?, ?)').run(row.action, row.target, row.details, row.at)
    else {
      const list = readJson('audit.json', [])
      list.push(row)
      writeJson('audit.json', list.slice(-1000))
    }
    return { ok: true }
  },
  'db:auditList': (limit) => {
    const n = Math.min(Math.max(Number(limit) || 200, 1), 1000)
    const database = getDb()
    if (database) return database.prepare('SELECT id, action, target, details, at FROM audit ORDER BY id DESC LIMIT ?').all(n)
    return readJson('audit.json', []).slice(-n).reverse().map((row, i) => ({ id: i + 1, ...row }))
  },
  'db:cacheGet': (key) => {
    const database = getDb()
    if (database) {
      const row = database.prepare('SELECT value FROM kv WHERE key = ?').get(String(key))
      return row ? row.value : null
    }
    const cache = readJson('cache.json', {})
    return cache[key] ?? null
  },
  'db:cachePut': (key, value) => {
    const database = getDb()
    if (database) {
      database.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
        .run(String(key), String(value), new Date().toISOString())
      return { ok: true }
    }
    const cache = readJson('cache.json', {})
    cache[key] = value
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
  return win
}

app.whenReady().then(() => {
  registerIpc()
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
