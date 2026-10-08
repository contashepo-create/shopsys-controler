#!/usr/bin/env node
/**
 * verify:license — فحص نواة الترخيص بلا شبكة ولا أسرار.
 *
 *  ① ثابت المفتاح العام مطابق لما هو مترجم داخل تطبيق العميل (قيمة معروفة).
 *  ② التوقيع المحلي + التحقق الذاتي يعملان (زوج مؤقت).
 *  ③ ترتيب الحقول القياسي مطابق للمتجه الذهبي المولَّد من مكتبة البوت.
 *  ④ بصمة djb2 = 8 hex.
 *  ⑤ (اختياري) إن كان مستودع shopsys موجوداً: توقيعنا يُتحقق بمكتبة البوت الحقيقية
 *      وتوقيع البوت يُتحقق بنواتنا — توافق ثنائي الاتجاه.
 *
 * التشغيل: node --experimental-strip-types scripts/verify_license_core.mjs
 * أو: npm run verify:license
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'

// fileURLToPath: يعمل على لينكس وويندوز (‎.pathname يُنتج /D:/‎ على ويندوز ويكسر join)
const here = dirname(fileURLToPath(import.meta.url))
const core = await import(pathToFileURL(join(here, '..', 'src', 'core', 'license.ts')).href)

const EXPECTED_PUBLIC = 'mOugSh8oJdc5H6nB9mMTNQYjyXzYle2RJepQkob3msE'
const GOLDEN_KEY = 'SHOPSYS1.eyJ2IjoxLCJkZXZpY2VJZCI6IlNIT1AtVEVTVC1ERVYxLUtFWTEiLCJjdXN0b21lciI6ItmF2K3ZhCDYp9mE2KfYrtiq2KjYp9ixIiwicGxhbiI6InBybyIsImZlYXR1cmVzIjpbIm11bHRpX2JyYW5jaCIsInRlbGVncmFtX2JvdCJdLCJpc3N1ZWRBdCI6IjIwMjYtMTAtMDgiLCJleHBpcmVzQXQiOiIyMDI3LTEwLTA4IiwiZXh0cmFVc2VycyI6MiwiZXh0cmFCcmFuY2hlcyI6MSwiYWN0aXZpdHlJZCI6Imdyb2NlcnkiLCJleHRyYU1vZHVsZXMiOlsiaW52ZW50b3J5IiwicG9zIl19.7ftrZF82ee4-_h6uM17SXuL_EzUHFjyc69WoZNgsfhUC5oUM-aJRdpUaxE3wSg-RpUrZ_ryQG-DPM-0n8dQlBw'
const GOLDEN_PRIV = 'MC4CAQAwBQYDK2VwBCIEIIUlHsUUZufbayCDB2dZLSNHKlR9wgviKGLTl84dZVfy'
const GOLDEN_FP = '9ed2fc4c'
// المفتاح العام للزوج المؤقت الذي وُلِّد به المتجه الذهبي (اختبار فقط — ليس مفتاح النشر)
const GOLDEN_PUB = 'Hcs4o4tJhg_mnYLUknmf-Y6FAJpRKVzsNwfLRtR5iMY'

let pass = 0
let fail = 0
function check(label, ok, detail = '') {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`) }
  else { fail += 1; console.error(`  ✖ ${label}${detail ? ' — ' + detail : ''}`) }
}

console.log('\n🔑 فحص نواة الترخيص (مركز تحكم المطور)\n')

console.log('① المفتاح العام والمطابقة مع التطبيق')
check('ثابت المفتاح العام مطابق للتطبيق', core.DEVELOPER_PUBLIC_KEY_B64U === EXPECTED_PUBLIC, core.DEVELOPER_PUBLIC_KEY_B64U)

console.log('\n② عقد الترميز')
const sample = new Uint8Array([1, 2, 3, 250, 251, 252])
check('base64url بلا حشوة ويطابق Buffer', core.b64uEncode(sample) === Buffer.from(sample).toString('base64url'))
check('فك الترميز يعيد نفس البايتات', [...core.b64uDecode(core.b64uEncode(sample))].join() === [...sample].join())

console.log('\n③ المتجه الذهبي (مولَّد من مكتبة البوت)')
const payload = {
  v: 1, deviceId: 'SHOP-TEST-DEV1-KEY1', customer: 'محل الاختبار', plan: 'pro',
  features: ['telegram_bot', 'multi_branch'], issuedAt: '2026-10-08', expiresAt: '2027-10-08',
  extraUsers: 2, extraBranches: 1, activityId: 'grocery', extraModules: ['pos', 'inventory'],
}
const signed = await core.issueLicenseKey(payload, GOLDEN_PRIV)
check('التوقيع المحلي يطابق متجه البوت بايت ببايت', signed === GOLDEN_KEY)
check('بصمة djb2 = 8 hex مطابقة', core.keyFingerprint(GOLDEN_KEY) === GOLDEN_FP, core.keyFingerprint(GOLDEN_KEY))

console.log('\n④ تحقق ورفض')
let verified = false
try {
  const p = await core.verifyLicenseKey(GOLDEN_KEY, 'SHOP-TEST-DEV1-KEY1', GOLDEN_PUB)
  verified = p.plan === 'pro'
} catch { verified = false }
check('المتجه الذهبي يمر بالتحقق الكامل (توقيع + جهاز)', verified)
let deviceRejected = false
try { await core.verifyLicenseKey(GOLDEN_KEY, 'SHOP-OTHR-OTHR-OTHR', GOLDEN_PUB) } catch { deviceRejected = true }
check('مفتاح لجهاز آخر يُرفض', deviceRejected)
// المفتاح العام الحقيقي (المترجم في التطبيق) يجب أن يرفض مفتاح زوج الاختبار
let realRejected = false
try { await core.verifyLicenseKey(GOLDEN_KEY, 'SHOP-TEST-DEV1-KEY1') } catch { realRejected = true }
check('المفتاح العام الحقيقي يرفض أي توقيع ليس من مفتاح النشر', realRejected)
// مفتاح موقّع بمفتاح خاص آخر يجب أن يُرفض بالمفتاح العام الحقيقي
const tempPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const tempPriv = Buffer.from(new Uint8Array(await crypto.subtle.exportKey('pkcs8', tempPair.privateKey))).toString('base64url')
const foreign = await core.issueLicenseKey({ ...payload, plan: 'lifetime' }, tempPriv)
let rejected = false
try { await core.verifyLicenseKey(foreign, 'SHOP-TEST-DEV1-KEY1'); } catch { rejected = true }
check('مفتاح بمفتاح خاص مجهول يُرفض بالمفتاح العام الحقيقي', rejected)

console.log('\n⑤ توافق ثنائي الاتجاه مع مكتبة البوت الحقيقية (إن وُجدت)')
const devbotPath = process.env.SHOPSYS_DEV_BOT || '/tmp/shopsys-main/tools/devbot/src/licenseLib.js'
if (existsSync(devbotPath)) {
  const bot = await import(pathToFileURL(devbotPath).href)
  const botKey = await bot.issueLicenseKey({ ...payload, plan: 'basic' }, tempPriv)
  const ourPub = core.b64uEncode(new Uint8Array(await crypto.subtle.exportKey('spki', tempPair.publicKey)).slice(-32))
  let ok1 = false
  try { ok1 = (await core.verifyLicenseKey(botKey, payload.deviceId, ourPub)).plan === 'basic' } catch { ok1 = false }
  check('مفتاح أصدرته مكتبة البوت يُتحقق بنواتنا', ok1)
  // نفس الحمولة ونفس المفتاح الخاص ⇒ يجب أن يتطابق الناتج حرفياً (Ed25519 حتمي)
  const ourKey = await core.issueLicenseKey({ ...payload, plan: 'trial' }, tempPriv)
  const botKeySame = await bot.issueLicenseKey({ ...payload, plan: 'trial' }, tempPriv)
  check('نفس الحمولة ⇒ نفس المفتاح حرفياً من الطرفين', ourKey === botKeySame)
  check('البصمة متطابقة بين الطرفين', core.keyFingerprint(botKey) === bot.keyFingerprint(botKey))
} else {
  console.log('  ⓘ مكتبة البوت غير موجودة هنا — تُتخطى (تعمل في بيئة التطوير الكاملة)')
}

console.log('\n⑥ حدود الخطط والميزات')
const PLAN_LIMITS_REF = { trial: [1, 1], basic: [1, 1], pro: [5, 2], lifetime: [10, 3] }
for (const [plan, [users, branches]] of Object.entries(PLAN_LIMITS_REF)) {
  const l = core.PLAN_LIMITS[plan]
  check(`حدود ${plan}: ${users} مستخدم / ${branches} فرع`, l.maxUsers === users && l.maxBranches === branches)
}
check('الميزات الست معرّفة', core.LICENSE_FEATURES.length === 6)
check('قائمة الوحدات الإضافية مطابقة للبوت (18 وحدة)', core.EXTRA_MODULES.length === 18)

console.log(`\n═══ النتيجة: ${pass} ناجح · ${fail} فاشل ═══\n`)
process.exit(fail === 0 ? 0 : 1)
