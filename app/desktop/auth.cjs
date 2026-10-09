/**
 * مصادقة اللوحة في العملية الرئيسية — المصدر الوحيد للحقيقة عن «هل اللوحة مفتوحة؟».
 *
 * لماذا هنا وليس في الواجهة:
 *   · التحقق من كلمة المرور يحتاج «ملح» التجزئة المخزّن؛ الواجهة كانت تُجزّئ بملح عشوائي جديد
 *     ثم تقارن ⇒ لا تطابق أبداً، ثم كانت تعامل الكائن المُعاد { ok:false } كقيمة صحيحة ⇒ أي كلمة
 *     مرور تفتح اللوحة. الآن: PBKDF2 بالملح والتكرارات المخزّنة + مقارنة ثابتة الزمن.
 *   · العمليات الحساسة (التوقيع، الأسرار، Cloudflare، البوت) تُرفض ما دامت اللوحة مقفلة —
 *     فلا يكفي تجاوز شاشة القفل في الواجهة لإصدار تراخيص.
 *   · رمز الاستعادة (OTP) يُولَّد ويُتحقق منه هنا، وتعيين كلمة مرور جديدة وهي مقفلة لا يمرّ إلا به.
 *
 * يجب أن تطابق معاملات PBKDF2 ملف src/core/password.ts (SHA-256، مفتاح 32 بايت، base64).
 */
const nodeCrypto = require('node:crypto')

const KEY_BYTES = 32
const MIN_ITERATIONS = 100_000
const MAX_ITERATIONS = 5_000_000
const MAX_FAILS = 5
const COOLDOWN_MS = 30_000
const OTP_TTL_MS = 5 * 60 * 1000
const OTP_MAX_ATTEMPTS = 3
const OTP_RESEND_MS = 30_000

const B64 = /^[A-Za-z0-9+/]+={0,2}$/

/** شكل تجزئة كلمة المرور المقبول للحفظ — يرفض أي شيء آخر بدل كتابة ملف مصادقة تالف. */
function isValidPasswordHash(h) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return false
  if (typeof h.salt !== 'string' || typeof h.hash !== 'string') return false
  if (!B64.test(h.salt) || !B64.test(h.hash)) return false
  if (Buffer.from(h.salt, 'base64').length < 8) return false
  if (Buffer.from(h.hash, 'base64').length !== KEY_BYTES) return false
  return Number.isInteger(h.iterations) && h.iterations >= MIN_ITERATIONS && h.iterations <= MAX_ITERATIONS
}

function pbkdf2(password, saltB64, iterations, crypto) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, Buffer.from(saltB64, 'base64'), iterations, KEY_BYTES, 'sha256', (err, key) =>
      err ? reject(err) : resolve(key))
  })
}

function sha256Hex(s, crypto) {
  return crypto.createHash('sha256').update(String(s).trim(), 'utf8').digest('hex')
}

function buildOtpMessage(appName, code, purposeAr) {
  return [
    `🔐 ${appName}`,
    `رمز التحقق لـ${purposeAr}:`,
    '',
    code,
    '',
    `صالح لمدة ${Math.round(OTP_TTL_MS / 60000)} دقائق — لا تشاركه مع أي أحد.`,
  ].join('\n')
}

/**
 * @param {object} deps
 * @param {(name: string) => any} deps.readAuth  يعيد المخزّن أو null (ويرمي عند ملف تالف)
 * @param {(value: any) => void} deps.writeAuth
 * @param {(text: string) => Promise<{ok: boolean, error?: string}>} deps.sendTelegram
 * @param {() => number} [deps.now]
 * @param {typeof nodeCrypto} [deps.crypto]
 * @param {string} [deps.appName]
 */
function createAuth(deps) {
  const crypto = deps.crypto || nodeCrypto
  const now = deps.now || Date.now
  const appName = deps.appName || 'مركز تحكم المطور'
  let unlocked = false
  let fails = 0
  let cooldownUntil = 0
  /** @type {{hash: string, expiresAt: number, attempts: number, sentAt: number} | null} */
  let otp = null

  function stored() {
    const s = deps.readAuth()
    return isValidPasswordHash(s) ? s : null
  }

  function hasPassword() {
    try { return stored() != null } catch { return true /* ملف موجود لكنه تالف: لا نعامله كأول تشغيل */ }
  }

  async function verify(password) {
    const t = now()
    if (t < cooldownUntil) return { ok: false, code: 'cooldown', retryInMs: cooldownUntil - t }
    if (typeof password !== 'string' || password.length === 0 || password.length > 512) return { ok: false, code: 'wrong' }
    const s = stored()
    if (!s) return { ok: false, code: 'no_password' }
    const expected = Buffer.from(s.hash, 'base64')
    const actual = await pbkdf2(password, s.salt, s.iterations, crypto)
    const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
    if (ok) {
      unlocked = true
      fails = 0
      return { ok: true }
    }
    fails += 1
    if (fails >= MAX_FAILS) {
      fails = 0
      cooldownUntil = now() + COOLDOWN_MS
      return { ok: false, code: 'cooldown', retryInMs: COOLDOWN_MS }
    }
    return { ok: false, code: 'wrong', attemptsLeft: MAX_FAILS - fails }
  }

  /** أول تشغيل (لا كلمة مرور) أو اللوحة مفتوحة فقط — الاستعادة وهي مقفلة تمرّ عبر resetWithOtp. */
  function setPassword(hash) {
    if (!isValidPasswordHash(hash)) return { ok: false, code: 'invalid', error: 'صيغة كلمة المرور المُجزّأة غير صالحة' }
    const first = !hasPassword()
    if (!first && !unlocked) return { ok: false, code: 'locked', error: 'اللوحة مقفلة — استخدم «نسيت كلمة المرور؟»' }
    deps.writeAuth({ salt: hash.salt, hash: hash.hash, iterations: hash.iterations })
    if (first) unlocked = true
    return { ok: true }
  }

  async function requestOtp(purposeAr) {
    if (!hasPassword()) return { ok: false, code: 'no_password', error: 'لا توجد كلمة مرور لاستعادتها' }
    const t = now()
    if (otp && t - otp.sentAt < OTP_RESEND_MS) {
      return { ok: false, code: 'too_soon', error: `انتظر ${Math.ceil((OTP_RESEND_MS - (t - otp.sentAt)) / 1000)} ثانية قبل إعادة الإرسال` }
    }
    // crypto.randomInt توزيع منتظم (بلا انحياز «بايت % 10»)
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
    const purpose = typeof purposeAr === 'string' && purposeAr.trim() ? purposeAr.trim().slice(0, 40) : 'استعادة كلمة المرور'
    const res = await deps.sendTelegram(buildOtpMessage(appName, code, purpose))
    if (!res || res.ok !== true) return { ok: false, code: 'send_failed', error: (res && res.error) || 'تعذر إرسال الرمز' }
    otp = { hash: sha256Hex(code, crypto), expiresAt: t + OTP_TTL_MS, attempts: 0, sentAt: t }
    return { ok: true, expiresAt: otp.expiresAt, maxAttempts: OTP_MAX_ATTEMPTS }
  }

  /** يتحقق من الرمز ثم يحفظ كلمة المرور الجديدة. الصيغة تُفحص أولاً فلا تُستهلك محاولة على مدخل تالف. */
  function resetWithOtp(code, hash) {
    if (!isValidPasswordHash(hash)) return { ok: false, code: 'invalid', error: 'صيغة كلمة المرور المُجزّأة غير صالحة' }
    if (!otp) return { ok: false, code: 'no_otp', error: 'لا يوجد رمز نشط — أرسل رمزاً جديداً' }
    if (now() > otp.expiresAt) { otp = null; return { ok: false, code: 'expired', error: 'انتهت صلاحية الرمز — أعد الإرسال' } }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) { otp = null; return { ok: false, code: 'locked', error: 'محاولات كثيرة خاطئة — أعد الإرسال' } }
    otp.attempts += 1
    const a = Buffer.from(sha256Hex(code, crypto), 'hex')
    const b = Buffer.from(otp.hash, 'hex')
    if (!crypto.timingSafeEqual(a, b)) {
      const attemptsLeft = OTP_MAX_ATTEMPTS - otp.attempts
      if (attemptsLeft <= 0) { otp = null; return { ok: false, code: 'locked', error: 'محاولات كثيرة خاطئة — أعد الإرسال' } }
      return { ok: false, code: 'wrong', attemptsLeft, error: `رمز خاطئ — تبقى ${attemptsLeft} ${attemptsLeft === 1 ? 'محاولة' : 'محاولات'}` }
    }
    otp = null
    deps.writeAuth({ salt: hash.salt, hash: hash.hash, iterations: hash.iterations })
    fails = 0
    cooldownUntil = 0
    return { ok: true }
  }

  return {
    hasPassword,
    isUnlocked: () => unlocked,
    /** مسموح بالعمليات الحساسة: اللوحة مفتوحة، أو أول تشغيل قبل إنشاء كلمة المرور */
    isAllowed: () => unlocked || !hasPassword(),
    lock: () => { unlocked = false; return { ok: true } },
    verify,
    setPassword,
    requestOtp,
    resetWithOtp,
  }
}

module.exports = { createAuth, isValidPasswordHash, buildOtpMessage, OTP_TTL_MS, OTP_MAX_ATTEMPTS, MAX_FAILS, COOLDOWN_MS, OTP_RESEND_MS }
