/**
 * الترخيص — نسخة مطابقة لـ app/src/core/license.ts في تطبيق shopsys (المرجع b47043c، v1.0.21).
 * ⚠️ لا تعدّل هذا الجزء يدوياً: أي فرق مع التطبيق يكسر التوقيع أو البصمة عند العميل.
 * الجزء الخاص باللوحة (الأقسام الإضافية، عناوين الميزات والأقسام، أدوات التاريخ) في آخر الملف.
 * ⚠️ الأقسام الـ18 يجب أن تطابق ALL_MODULES في تطبيق shopsys (activities.ts).
 */
/**
 * الترخيص — ShopSys (المرحلة 5) — منقول مفهومياً من نظام mobileshop (القرار 4)
 * ─────────────────────────────────────────────────────────────────────────────
 * Ed25519 عبر WebCrypto (متاح في المتصفحات الحديثة وElectron وNode):
 * - المفتاح الخاص عند المطوّر فقط (scripts/license_tool.mjs)
 * - المفتاح العام مضمّن في التطبيق — لا يمكن تزوير مفتاح تفعيل
 * - المفتاح مربوط بمعرّف الجهاز، له خطة وصلاحيات وتاريخ انتهاء
 * - ميزات حساسة (مثل الفاتورة الإلكترونية — القرار 21) تُفعَّل فقط
 *   عبر خصائص المفتاح الذي يصدره المطوّر
 * - كشف إرجاع ساعة الجهاز (trial anchor + آخر ظهور)
 */

/**
 * المفتاح العام للمطوّر (base64url — 32 بايت raw).
 * الخاص المقابل عند المطوّر فقط (خارج المستودع — انظر scripts/license_tool.mjs)
 */
export const DEVELOPER_PUBLIC_KEY_B64U = 'mOugSh8oJdc5H6nB9mMTNQYjyXzYle2RJepQkob3msE'

export type LicensePlan = 'trial' | 'basic' | 'pro' | 'lifetime'

/** ميزات تُفعَّل بمفتاح الترخيص فقط (قرار 21: الفاتورة الإلكترونية بيد المطوّر) */
export type LicenseFeature =
  | 'einvoice_eg'
  | 'einvoice_sa'
  | 'multi_branch'
  | 'telegram_bot'
  | 'cloud_sync' // مزامنة سحابية (Supabase) للفروع المتعددة — خدمة مدفوعة
  | 'multi_user_lan' // تعدد المستخدمين على الشبكة المحلية — خدمة مدفوعة

export interface LicensePayload {
  v: 1 // إصدار الصيغة
  deviceId: string
  customer: string // اسم العميل/المحل
  plan: LicensePlan
  features: LicenseFeature[]
  issuedAt: string // YYYY-MM-DD
  expiresAt: string | null // null = مدى الحياة
  /** مستخدمون إضافيون فوق حد الباقة — يبيعها المطوّر من البوت (اختياري) */
  extraUsers?: number
  /** فروع إضافية فوق حد الباقة — من البوت أيضاً (اختياري) */
  extraBranches?: number
  /**
   * قرار 28: المفتاح مربوط بالنشاط الذي سجّل به العميل (يظهر للمطوّر في
   * البوت مع بيانات الجهاز). لو مسح قاعدة البيانات وأنشأ نشاطاً آخر،
   * المفتاح القديم لا يعمل — والمطوّر يحرقه في قائمة الإبطال السحابية.
   * غيابه (مفاتيح قديمة) = يعمل مع أي نشاط.
   */
  activityId?: string
  /**
   * سياسة الأقسام (أمر المالك): المستخدم لا يضيف/يحذف أقساماً بنفسه —
   * الأقسام الافتراضية تتبع النشاط، وأي قسم إضافي يفعّله المطوّر فقط
   * من البوت بمفتاح موقَّع يحمل أسماء الوحدات الإضافية هنا.
   */
  extraModules?: string[]
}

/**
 * حدود الباقات (قرار المالك): الباقات شهرية وسنوية (تُضبط بـ expiresAt)،
 * والفرق بينها عدد المستخدمين وعدد الفروع، وتشغيل أكثر من نسخة على نفس
 * الشبكة/قاعدة البيانات ميزة الباقات العالية فقط.
 * الزيادات فوق الحد تصدر من بوت المطوّر بمفتاح جديد (extraUsers/extraBranches).
 */
export interface PlanLimits {
  maxUsers: number
  maxBranches: number
  /** أكثر من نسخة على نفس الشبكة وقاعدة البيانات (ERP) */
  multiInstance: boolean
}

export const PLAN_LIMITS: Record<LicensePlan, PlanLimits> = {
  // تعدد المستخدمين خدمة مدفوعة (قرار 28): التجربة والأساسي مستخدم واحد
  trial: { maxUsers: 1, maxBranches: 1, multiInstance: false },
  basic: { maxUsers: 1, maxBranches: 1, multiInstance: false },
  pro: { maxUsers: 5, maxBranches: 2, multiInstance: true },
  lifetime: { maxUsers: 10, maxBranches: 3, multiInstance: true },
}

/** الحدود الفعلية = حدود الباقة + الزيادات المشتراة من البوت */
export function effectiveLimits(payload: LicensePayload | null): PlanLimits {
  const base = PLAN_LIMITS[payload?.plan ?? 'trial']
  return {
    maxUsers: base.maxUsers + Math.max(0, payload?.extraUsers ?? 0),
    maxBranches: base.maxBranches + Math.max(0, payload?.extraBranches ?? 0),
    multiInstance: base.multiInstance,
  }
}

export type LicenseState =
  | { status: 'trial'; daysLeft: number }
  | { status: 'trial_expired' }
  | { status: 'active'; payload: LicensePayload; daysLeft: number | null }
  | { status: 'expired'; payload: LicensePayload }
  | { status: 'invalid'; reason: string }
  | { status: 'clock_tampered' }

export const TRIAL_DAYS = 14
const KEY_PREFIX = 'SHOPSYS1'

/* ─── base64url ─── */
export function b64uEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function b64uDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/**
 * ترتيب حتمي للحقول قبل التوقيع — نفس الترتيب دائماً في الإصدار والتحقق.
 * الحقلان الاختياريان (extraUsers/extraBranches) يدخلان الصيغة فقط عند وجودهما،
 * كي تبقى توقيعات المفاتيح القديمة (بلا زيادات) صحيحة كما هي.
 */
export function canonicalPayload(p: LicensePayload): string {
  const base: Record<string, unknown> = {
    v: p.v, deviceId: p.deviceId, customer: p.customer, plan: p.plan,
    features: [...p.features].sort(), issuedAt: p.issuedAt, expiresAt: p.expiresAt,
  }
  if (p.extraUsers != null) base.extraUsers = p.extraUsers
  if (p.extraBranches != null) base.extraBranches = p.extraBranches
  if (p.activityId != null) base.activityId = p.activityId
  if (p.extraModules != null) base.extraModules = [...p.extraModules].sort()
  return JSON.stringify(base)
}

/**
 * قرار 28 — ربط المفتاح بالنشاط:
 * المفتاح الموقّع على activityId يعمل فقط مع نفس النشاط الذي أُصدر له.
 * مسح قاعدة البيانات وإنشاء نشاط آخر ⇒ المفتاح لا يعمل محلياً،
 * والمطوّر يحرقه نهائياً في قائمة الإبطال (Cloudflare) فلا يعاد استخدامه.
 */
/** v1.0.7 (موافقة المالك): قائمة الأنشطة المصرّح بها على هذا الجهاز —
 * النشاط الأصلي وقت التفعيل + كل تغيير تم بمفتاح نشاط موقّع من المطور.
 * مفتاح التفعيل القديم يظل صالحاً بعد تغيير النشاط الموقّع. */
export function activityMatches(payload: LicensePayload, currentActivityId: string | null, licensedActivityHistory?: readonly string[]): boolean {
  if (payload.activityId == null) return true // مفاتيح قديمة بلا ربط
  if (payload.activityId === currentActivityId) return true
  // النشاط تغيّر لاحقاً بمفتاح موقّع: نشاط المفتاح ونشاط الحالي كلاهما بالسجل
  if (licensedActivityHistory == null) return false
  return licensedActivityHistory.includes(currentActivityId ?? '') && licensedActivityHistory.includes(payload.activityId)
}

/* ═══ مفتاح تغيير النشاط (v1.0.7): SHOPSYS2.<payload>.<sig> ═══
 * يوقّعه المطوّر فقط (نفس زوج Ed25519) لعميل محدد وجهاز محدد:
 * التطبيق يطبّق التغيير ويقفل النشاط — المستخدم لا يغيّره بنفسه بأي طريق. */
export const ACTIVITY_KEY_PREFIX = 'SHOPSYS2'

/** الحد الأدنى بين تغييرين للنشاط (طلب المالك: تقييد التغيير شهرياً) */
export const ACTIVITY_CHANGE_COOLDOWN_DAYS = 30

export interface ActivityChangePayload {
  v: 1
  deviceId: string
  fromActivityId: string
  toActivityId: string
  issuedAt: string
}

export function canonicalActivityChangePayload(p: ActivityChangePayload): string {
  return JSON.stringify({ v: p.v, deviceId: p.deviceId, fromActivityId: p.fromActivityId, toActivityId: p.toActivityId, issuedAt: p.issuedAt })
}

export function encodeActivityChangeKey(payload: ActivityChangePayload, signature: Uint8Array): string {
  const body = b64uEncode(new TextEncoder().encode(canonicalActivityChangePayload(payload)))
  return `${ACTIVITY_KEY_PREFIX}.${body}.${b64uEncode(signature)}`
}

/** تحقق كامل من مفتاح النشاط: توقيع المطوّر + الجهاز المطابق. يعيد الحمولة أو يرمي */
export async function verifyActivityChangeKey(
  key: string,
  deviceId: string,
  pubB64u: string = DEVELOPER_PUBLIC_KEY_B64U,
): Promise<ActivityChangePayload> {
  const parts = key.trim().split('.')
  if (parts.length !== 3 || parts[0] !== ACTIVITY_KEY_PREFIX) throw new Error('صيغة مفتاح تغيير النشاط غير صحيحة')
  let payload: ActivityChangePayload
  try {
    payload = JSON.parse(new TextDecoder().decode(b64uDecode(parts[1]))) as ActivityChangePayload
  } catch {
    throw new Error('محتوى مفتاح النشاط تالف')
  }
  if (payload.v !== 1 || !payload.deviceId || !payload.fromActivityId || !payload.toActivityId || !payload.issuedAt) {
    throw new Error('مفتاح النشاط ناقص البيانات')
  }
  const pub = await importPublicKey(pubB64u)
  const msg = new TextEncoder().encode(canonicalActivityChangePayload(payload))
  const ok = await crypto.subtle.verify('Ed25519', pub, b64uDecode(parts[2]) as unknown as ArrayBuffer, msg as unknown as ArrayBuffer)
  if (!ok) throw new Error('توقيع مفتاح النشاط غير صحيح — ليس صادراً من المطوّر')
  if (payload.deviceId !== deviceId) throw new Error(`مفتاح النشاط صادر لجهاز آخر (${payload.deviceId})`)
  return payload
}

/**
 * قائمة الإبطال (حرق المفاتيح): تُجلب من Cloudflare Worker وتُخزن محلياً.
 * البصمة = checksum توقيع المفتاح — لا نحتاج المفتاح كاملاً في القائمة.
 */
/**
 * ح1 (مراجعة ③ — ثغرة مؤكدة بالتجربة): البصمة تُحسب على **البايتات المعيارية** للتوقيع
 * لا على نصه الخام. التوقيع الواحد يُكتب بصور يقبلها فك الترميز (حشو `=` بعد الجزء، أو
 * `+` و`/` بدل `-` و`_`)، وكلها تفك إلى البايتات نفسها فيمرّ التحقق، لكن البصمة النصية
 * تتغير فلا يُعرف المفتاح كمحروق. المفاتيح المعيارية الصادرة من المطوّر لا تتغير بصمتها.
 */
export function keyFingerprint(key: string): string {
  const raw = key.trim().split('.')[2] ?? key
  let sigPart = raw
  try { sigPart = b64uEncode(b64uDecode(raw)) } catch { /* ترميز تالف: البصمة على النص كما هو — التحقق سيفشل أصلاً */ }
  let h = 5381
  for (let i = 0; i < sigPart.length; i++) h = ((h << 5) + h + sigPart.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

export function isRevoked(key: string, revokedFingerprints: readonly string[]): boolean {
  return revokedFingerprints.includes(keyFingerprint(key))
}

/** توليد معرّف جهاز ثابت المظهر: SHOP-XXXX-XXXX-XXXX */
export function generateDeviceId(randomBytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // بلا حروف ملتبسة
  let s = ''
  for (let i = 0; i < 12; i++) s += alphabet[randomBytes[i] % alphabet.length]
  return `SHOP-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`
}

/** بنية مفتاح التفعيل: SHOPSYS1.<payload-b64u>.<sig-b64u> */
export function encodeLicenseKey(payload: LicensePayload, signature: Uint8Array): string {
  const body = b64uEncode(new TextEncoder().encode(canonicalPayload(payload)))
  return `${KEY_PREFIX}.${body}.${b64uEncode(signature)}`
}

export function decodeLicenseKey(key: string): { payload: LicensePayload; body: string; sig: Uint8Array } {
  const parts = key.trim().split('.')
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) throw new Error('صيغة مفتاح التفعيل غير صحيحة')
  let payload: LicensePayload
  try {
    payload = JSON.parse(new TextDecoder().decode(b64uDecode(parts[1]))) as LicensePayload
  } catch {
    throw new Error('محتوى المفتاح تالف')
  }
  if (payload.v !== 1 || !payload.deviceId || !payload.plan) throw new Error('محتوى المفتاح ناقص')
  return { payload, body: parts[1], sig: b64uDecode(parts[2]) }
}

/* ─── توقيع وتحقق (WebCrypto Ed25519) ─── */

export async function importPublicKey(pubB64u: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64uDecode(pubB64u) as unknown as ArrayBuffer, 'Ed25519', true, ['verify'])
}

/** تحقق كامل من مفتاح: توقيع صحيح + الجهاز مطابق. يعيد الحمولة أو يرمي */
export async function verifyLicenseKey(
  key: string,
  deviceId: string,
  pubB64u: string = DEVELOPER_PUBLIC_KEY_B64U,
): Promise<LicensePayload> {
  const { payload, sig } = decodeLicenseKey(key)
  const pub = await importPublicKey(pubB64u)
  // التحقق على الصيغة القانونية المعاد بناؤها — أي تلاعب بالحمولة يكسر التوقيع
  const msg = new TextEncoder().encode(canonicalPayload(payload))
  const ok = await crypto.subtle.verify('Ed25519', pub, sig as unknown as ArrayBuffer, msg as unknown as ArrayBuffer)
  if (!ok) throw new Error('التوقيع غير صحيح — المفتاح ليس صادراً من المطوّر')
  if (payload.deviceId !== deviceId) throw new Error(`المفتاح صادر لجهاز آخر (${payload.deviceId})`)
  return payload
}

/**
 * قبول مفتاح تفعيل — نقطة الدخول الوحيدة لشاشتي القفل و«الترخيص» (مراجعة 2026-10-09 · M4).
 * كانت شاشة «الترخيص» تتجاوز فحص الإبطال وتطابق النشاط فتحفظ مفتاحاً مُبطلاً
 * ويستبدل المفتاح الصالح. الآن الفحوص الثلاثة في مكان واحد لا يمكن تجاوزه.
 */
export async function acceptActivationKey(args: {
  key: string
  deviceId: string
  revokedKeys: readonly string[]
  activityId: string | null
  activityKeyHistory?: readonly string[]
  /** اختياري للاختبار فقط — الإنتاج يستخدم المفتاح العام المدمج */
  pubB64u?: string
}): Promise<LicensePayload> {
  const key = args.key.trim()
  if (isRevoked(key, args.revokedKeys)) throw new Error('هذا المفتاح محروق (مُبطل من المطوّر) — اطلب مفتاحاً جديداً')
  const payload = await verifyLicenseKey(key, args.deviceId, args.pubB64u)
  if (!activityMatches(payload, args.activityId, args.activityKeyHistory)) throw new Error('المفتاح صادر لنشاط آخر — اطلب مفتاحاً لنشاطك الحالي')
  return payload
}

/* ─── حالة الترخيص (منطق خالص قابل للفحص) ─── */

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso.slice(0, 10)) - Date.parse(fromIso.slice(0, 10))) / 86_400_000)
}

/** يوم بصيغة YYYY-MM-DD (يُقبل ISO كامل بقص الوقت) — لا يُقبل ما لا يُقرأ تاريخاً */
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/
export function isValidIsoDay(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 10) return false
  const day = value.slice(0, 10)
  return ISO_DAY_RE.test(day) && Number.isFinite(Date.parse(day))
}

/** أقدم يوم صالح بين المرشحين — مرساة بداية التجربة: الأقدم هو الدليل الأوثق */
export function oldestValidDay(...candidates: unknown[]): string | null {
  let best: string | null = null
  for (const c of candidates) if (isValidIsoDay(c) && (best === null || c.slice(0, 10) < best.slice(0, 10))) best = c
  return best
}

/** أحدث يوم صالح بين المرشحين — مرساة «آخر ظهور»: لا رجوع للخلف أبداً */
export function newestValidDay(...candidates: unknown[]): string | null {
  let best: string | null = null
  for (const c of candidates) if (isValidIsoDay(c) && (best === null || c.slice(0, 10) > best.slice(0, 10))) best = c
  return best
}

/**
 * تقييم الحالة:
 * - ساعة مرجعة (اليوم < آخر ظهور مسجل) ⇒ clock_tampered
 * - مفتاح مفعّل: سارٍ أو منتهٍ حسب expiresAt
 * - لا مفتاح: تجربة 14 يوماً من مرساة أول تشغيل
 */
export function evaluateLicense(args: {
  activatedPayload: LicensePayload | null
  trialStartedAt: string // ISO أول تشغيل
  lastSeenAt: string // آخر يوم شوهد (مرساة ضد إرجاع الساعة)
  today: string // ISO اليوم
}): LicenseState {
  /* ح2 (مراجعة ③): فشل مغلق على كل قيمة زمنية تالفة. قبل هذا الإصلاح كانت trialStartedAt = ""
     تعطي left = NaN فلا يتحقق `<= 0` أبداً ⇒ تجربة لا تنتهي (مؤكد بالتجربة). */
  if (!isValidIsoDay(args.today)) return { status: 'invalid', reason: 'تاريخ الجهاز غير صالح' }
  const today = args.today.slice(0, 10)
  // مرساة «آخر ظهور» التالفة = أثر إرجاع الساعة مُحي ⇒ تعامل كتلاعب
  if (!isValidIsoDay(args.lastSeenAt)) return { status: 'clock_tampered' }
  if (today < args.lastSeenAt.slice(0, 10)) return { status: 'clock_tampered' }

  if (args.activatedPayload) {
    const p = args.activatedPayload
    if (p.expiresAt === null) return { status: 'active', payload: p, daysLeft: null }
    if (!isValidIsoDay(p.expiresAt)) return { status: 'invalid', reason: 'تاريخ انتهاء المفتاح غير صالح' }
    const left = daysBetween(today, p.expiresAt)
    if (left < 0) return { status: 'expired', payload: p }
    return { status: 'active', payload: p, daysLeft: left }
  }

  if (!isValidIsoDay(args.trialStartedAt)) return { status: 'invalid', reason: 'بداية التجربة المحفوظة غير صالحة' }
  const used = daysBetween(args.trialStartedAt, today)
  if (used < 0) return { status: 'clock_tampered' } // اليوم قبل بداية التجربة
  const left = TRIAL_DAYS - used
  if (left <= 0) return { status: 'trial_expired' }
  return { status: 'trial', daysLeft: left }
}

/** هل ميزة مرخّصة؟ (الفاتورة الإلكترونية وغيرها لا تعمل إلا بمفتاح يحملها) */
export function hasFeature(state: LicenseState, feature: LicenseFeature): boolean {
  return state.status === 'active' && state.payload.features.includes(feature)
}

/* ═══ نزاهة الترخيص عند الإقلاع (ث1 — تدقيق 2026-10-08) ═══════════════════
 * الثغرة: التطبيق كان يقيّم الحالة من `activatedPayload` **المحفوظ في التخزين**
 * ولا يعيد التحقق من التوقيع إلا عند إدخال مفتاح يدوياً. وفي نسخة الويب
 * التخزين نص صريح (localStorage) ⇒ كتابة حمولة `{plan:'lifetime',expiresAt:null}`
 * بيد المستخدم تفتح كل الميزات المدفوعة بلا أي مفتاح موقّع.
 *
 * القاعدة الجديدة: **المفتاح الموقّع هو المصدر الوحيد للحمولة.**
 * التخزين يحمل `activatedKey` فقط، والحمولة تُشتق منه في كل إقلاع، وأي
 * حمولة محفوظة لا يسندها مفتاح صالح تُعتبر تلاعباً وتُمسح. */

export type StoredLicenseAudit =
  /** لا مفتاح مخزّن ⇒ لا تفعيل (والحمولة المحفوظة — إن وُجدت — باطلة) */
  | { kind: 'no_key'; hadStoredPayload: boolean }
  /** المفتاح تحقّق ⇒ الحمولة الموثوقة هي الناتجة من التوقيع */
  | { kind: 'verified'; payload: LicensePayload; storedPayloadDiffered: boolean }
  /** مفتاح مخزّن لكنه فاسد/معدّل/لجهاز آخر ⇒ يُسقط التفعيل */
  | { kind: 'tampered'; reason: string }

/**
 * قرار فحص الترخيص المحفوظ — دالة خالصة (بلا crypto):
 * تستقبل نتيجة التحقق (`verifiedPayload` أو سبب الفشل) وتقرر ما يُعتمد.
 * لا تُرجع الحمولة المحفوظة أبداً: إما حمولة التوقيع أو لا شيء.
 */
export function auditStoredLicense(args: {
  activatedKey: string | null
  storedPayload: LicensePayload | null
  verifiedPayload: LicensePayload | null
  verifyError?: string | null
}): StoredLicenseAudit {
  const key = typeof args.activatedKey === 'string' ? args.activatedKey.trim() : ''
  if (!key) return { kind: 'no_key', hadStoredPayload: args.storedPayload != null }
  if (args.verifiedPayload) {
    return {
      kind: 'verified',
      payload: args.verifiedPayload,
      storedPayloadDiffered: JSON.stringify(args.storedPayload ?? null) !== JSON.stringify(args.verifiedPayload),
    }
  }
  return { kind: 'tampered', reason: args.verifyError?.trim() || 'مفتاح التفعيل المخزّن غير صالح' }
}

/** هل الاستخدام مسموح أصلاً؟ (تجربة سارية أو مفتاح سارٍ) */
export function isUsable(state: LicenseState): boolean {
  return state.status === 'trial' || state.status === 'active'
}

export const PLAN_LABELS: Record<LicensePlan, string> = {
  trial: 'تجريبي',
  basic: 'أساسي',
  pro: 'احترافي',
  lifetime: 'مدى الحياة',
}

export const FEATURE_LABELS: Record<LicenseFeature, string> = {
  einvoice_eg: 'الفاتورة الإلكترونية — مصر',
  einvoice_sa: 'الفاتورة الإلكترونية — السعودية (زاتكا)',
  multi_branch: 'فروع متعددة',
  telegram_bot: 'بوت التليجرام',
  cloud_sync: 'مزامنة سحابية للفروع (Supabase)',
  multi_user_lan: 'تعدد المستخدمين على الشبكة المحلية',
}

/* ─── خاص باللوحة (ليس جزءاً من عقد التطبيق) ─── */

/** معرّف الجهاز: SHOP-XXXX-XXXX-XXXX */
export const DEVICE_ID_RE = /^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/

/** ميزات تُعرض وتُمنح من اللوحة */
export const LICENSE_FEATURES: readonly LicenseFeature[] = [
  'einvoice_eg',
  'einvoice_sa',
  'multi_branch',
  'telegram_bot',
  'cloud_sync',
  'multi_user_lan',
]

export const FEATURE_LABELS_AR: Record<LicenseFeature, string> = {
  einvoice_eg: 'الفاتورة الإلكترونية المصرية',
  einvoice_sa: 'الفاتورة الإلكترونية السعودية',
  multi_branch: 'تعدد الفروع',
  telegram_bot: 'بوت تليجرام',
  cloud_sync: 'المزامنة السحابية',
  multi_user_lan: 'تعدد المستخدمين على الشبكة',
}

/** الوحدات الـ18 القابلة للمنح بمفتاح موقّع (extraModules — عقد إضافة قسم خارج النشاط) */
export const EXTRA_MODULES: readonly string[] = [
  'pos', 'inventory', 'purchases', 'installments', 'recipes', 'processing', 'jewelry',
  'maintenance', 'laundry', 'booking', 'equipment_rental', 'logistics', 'lab',
  'contracting', 'clinic', 'cars', 'wallet_services', 'realestate',
]

export const MODULE_LABELS_AR: Record<string, string> = {
  pos: 'نقطة البيع', inventory: 'المخزون', purchases: 'المشتريات', installments: 'الأقساط',
  recipes: 'الوصفات', processing: 'التصنيع', jewelry: 'الذهب والمجوهرات', maintenance: 'الصيانة',
  laundry: 'المغسلة', booking: 'الحجوزات', equipment_rental: 'تأجير المعدات', logistics: 'اللوجستيات',
  lab: 'المختبر', contracting: 'المقاولات', clinic: 'العيادة', cars: 'السيارات',
  wallet_services: 'الخدمات المالية', realestate: 'العقارات',
}

export const PLAN_LABELS_AR: Record<LicensePlan, string> = {
  trial: 'تجريبي',
  basic: 'أساسي',
  pro: 'احترافي',
  lifetime: 'مدى الحياة',
}

/** تاريخ انتهاء ISO (YYYY-MM-DD) بعد عدد الأيام — null = مدى الحياة */
export function expiresAfterDays(days: number | null | undefined, todayIso = new Date().toISOString().slice(0, 10)): string | null {
  if (days == null || days <= 0) return null
  const d = new Date(todayIso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/* ─── إصدار المفاتيح (المطوّر فقط — اللوحة تحمل المفتاح الخاص في الجهاز) ─── */

export async function importPrivateKey(privB64u: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', b64uDecode(privB64u) as unknown as ArrayBuffer, 'Ed25519', false, ['sign'])
}

/** إصدار مفتاح تفعيل موقّع: SHOPSYS1.<payload-b64u>.<sig-b64u> (مطابق encodeLicenseKey) */
export async function issueLicenseKey(payload: LicensePayload, privB64u: string): Promise<string> {
  const priv = await importPrivateKey(privB64u)
  const msg = new TextEncoder().encode(canonicalPayload(payload))
  const sig = await crypto.subtle.sign('Ed25519', priv, msg)
  return encodeLicenseKey(payload, new Uint8Array(sig))
}

/** إصدار مفتاح تغيير نشاط موقّع: SHOPSYS2.<payload-b64u>.<sig-b64u> (مطابق encodeActivityChangeKey) */
export async function issueActivityChangeKey(payload: ActivityChangePayload, privB64u: string): Promise<string> {
  const priv = await importPrivateKey(privB64u)
  const msg = new TextEncoder().encode(canonicalActivityChangePayload(payload))
  const sig = await crypto.subtle.sign('Ed25519', priv, msg)
  return encodeActivityChangeKey(payload, new Uint8Array(sig))
}

export { KEY_PREFIX }
