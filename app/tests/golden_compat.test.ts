/**
 * اختبار التوافق الذهبي — «مركز تحكم المطور» ↔ بوت المطوّر ↔ تطبيق تَحَكَّم.
 *
 * المتجه (vector) أدناه وُلِّد فعلياً بمكتبة البوت الحقيقية
 * (tools/devbot/src/licenseLib.js) وثُبِّت هنا. أي انحراف في ترتيب الحقول
 * أو الترميز أو التوقيع يفشل هذه الاختبارات فوراً:
 *
 *   ① التوقيع المحلي باللوحة يعيد المفتاح الذهبي **بنفس البايتات** (Ed25519 حتمي).
 *   ② الحمولة القياسية (canonicalPayload) مطابقة حرفياً للناتج المحفوظ من البوت.
 *   ③ بصمة الحرق djb2 — الثمانية hex — مطابقة.
 *   ④ التحقق الكامل (توقيع + جهاز) يمر على مفتاح أصدره البوت.
 *   ⑤ السالب: تشويه أي بايت من التوقيع أو تغيير الجهاز يفشل التحقق.
 *
 * زوج المفاتيح هنا مؤقت للاختبار فقط (وُلِّد لهذا الملف ولا يُستخدم للنشر).
 */
import { describe, it, expect } from 'vitest'
import {
  issueLicenseKey, verifyLicenseKey, decodeLicenseKey, canonicalPayload,
  keyFingerprint, b64uEncode, b64uDecode, expiresAfterDays, generateDeviceId,
  effectiveLimits, PLAN_LIMITS, isRevoked, encodeLicenseKey,
  type LicensePayload,
} from '../src/core/license.ts'

/* ═══ متجه ذهبي ثابت — مولَّد بـ tools/devbot/src/licenseLib.js ═══ */

const GOLDEN_PRIV = 'MC4CAQAwBQYDK2VwBCIEIIUlHsUUZufbayCDB2dZLSNHKlR9wgviKGLTl84dZVfy'
const GOLDEN_PUB = 'Hcs4o4tJhg_mnYLUknmf-Y6FAJpRKVzsNwfLRtR5iMY'
const GOLDEN_KEY = 'SHOPSYS1.eyJ2IjoxLCJkZXZpY2VJZCI6IlNIT1AtVEVTVC1ERVYxLUtFWTEiLCJjdXN0b21lciI6ItmF2K3ZhCDYp9mE2KfYrtiq2KjYp9ixIiwicGxhbiI6InBybyIsImZlYXR1cmVzIjpbIm11bHRpX2JyYW5jaCIsInRlbGVncmFtX2JvdCJdLCJpc3N1ZWRBdCI6IjIwMjYtMTAtMDgiLCJleHBpcmVzQXQiOiIyMDI3LTEwLTA4IiwiZXh0cmFVc2VycyI6MiwiZXh0cmFCcmFuY2hlcyI6MSwiYWN0aXZpdHlJZCI6Imdyb2NlcnkiLCJleHRyYU1vZHVsZXMiOlsiaW52ZW50b3J5IiwicG9zIl19.7ftrZF82ee4-_h6uM17SXuL_EzUHFjyc69WoZNgsfhUC5oUM-aJRdpUaxE3wSg-RpUrZ_ryQG-DPM-0n8dQlBw'
const GOLDEN_FP = '9ed2fc4c'
const GOLDEN_CANON = '{"v":1,"deviceId":"SHOP-TEST-DEV1-KEY1","customer":"محل الاختبار","plan":"pro","features":["multi_branch","telegram_bot"],"issuedAt":"2026-10-08","expiresAt":"2027-10-08","extraUsers":2,"extraBranches":1,"activityId":"grocery","extraModules":["inventory","pos"]}'

const GOLDEN_PAYLOAD: LicensePayload = {
  v: 1,
  deviceId: 'SHOP-TEST-DEV1-KEY1',
  customer: 'محل الاختبار',
  plan: 'pro',
  features: ['telegram_bot', 'multi_branch'], // بترتيب غير مرتَّب عمداً — يُرتَّب قبل التوقيع
  issuedAt: '2026-10-08',
  expiresAt: '2027-10-08',
  extraUsers: 2,
  extraBranches: 1,
  activityId: 'grocery',
  extraModules: ['pos', 'inventory'],
}

describe('التوافق الذهبي: اللوحة ↔ البوت ↔ التطبيق', () => {
  it('① التوقيع المحلي يعيد المفتاح الذهبي بنفس البايتات', async () => {
    const key = await issueLicenseKey(GOLDEN_PAYLOAD, GOLDEN_PRIV)
    expect(key).toBe(GOLDEN_KEY)
  })

  it('② الحمولة القياسية مطابقة حرفياً لناتج البوت', () => {
    expect(canonicalPayload(GOLDEN_PAYLOAD)).toBe(GOLDEN_CANON)
  })

  it('③ بصمة الحرق djb2 مطابقة (8 hex صغيرة)', () => {
    expect(keyFingerprint(GOLDEN_KEY)).toBe(GOLDEN_FP)
    expect(GOLDEN_FP).toMatch(/^[0-9a-f]{8}$/)
  })

  it('④ مفتاح البوت يمر بالتحقق الكامل (توقيع + جهاز)', async () => {
    const payload = await verifyLicenseKey(GOLDEN_KEY, 'SHOP-TEST-DEV1-KEY1', GOLDEN_PUB)
    expect(payload.plan).toBe('pro')
    expect(payload.customer).toBe('محل الاختبار')
    expect(payload.features).toEqual(['multi_branch', 'telegram_bot'])
    expect(payload.extraModules).toEqual(['inventory', 'pos'])
  })

  it('⑤ السالب: تشويه التوقيع أو الجهاز أو الخطة يفشل التحقق', async () => {
    const { sig } = decodeLicenseKey(GOLDEN_KEY)
    const tampered = new Uint8Array(sig)
    tampered[0] ^= 0xff
    const parts = GOLDEN_KEY.split('.')
    const badSigKey = `${parts[0]}.${parts[1]}.${b64uEncode(tampered)}`
    await expect(verifyLicenseKey(badSigKey, 'SHOP-TEST-DEV1-KEY1', GOLDEN_PUB)).rejects.toThrow()

    // مفتاح سليم لكن لجهاز آخر
    await expect(verifyLicenseKey(GOLDEN_KEY, 'SHOP-OTHR-OTHR-OTHR', GOLDEN_PUB)).rejects.toThrow(/جهاز آخر/)

    // حمولة معدَّلة (تُرفض بالتوقيع)
    const editedPayload: LicensePayload = { ...GOLDEN_PAYLOAD, plan: 'lifetime' }
    const fakeBody = b64uEncode(new TextEncoder().encode(canonicalPayload(editedPayload)))
    const forged = `${parts[0]}.${fakeBody}.${parts[2]}`
    await expect(verifyLicenseKey(forged, 'SHOP-TEST-DEV1-KEY1', GOLDEN_PUB)).rejects.toThrow(/التوقيع/)
  })

  it('بنية المفتاح: SHOPSYS1.payload.sig بلا حشوة', () => {
    const parts = GOLDEN_KEY.split('.')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('SHOPSYS1')
    expect(parts[1]).not.toContain('=')
    expect(parts[2]).not.toContain('=')
    const decoded = decodeLicenseKey(GOLDEN_KEY)
    expect(decoded.sig.length).toBe(64) // Ed25519 signature
  })

  it('ترميز base64url ذهاباً وإياباً بلا حشوة', () => {
    for (const len of [1, 2, 3, 16, 31, 32, 33, 64]) {
      const bytes = new Uint8Array(len)
      crypto.getRandomValues(bytes)
      const encoded = b64uEncode(bytes)
      expect(encoded).not.toContain('=')
      expect(encoded).not.toMatch(/[+/]/)
      expect([...b64uDecode(encoded)]).toEqual([...bytes])
    }
  })

  it('الحقول الاختيارية تدخل الصيغة فقط عند وجودها (نفس عقد العميل)', () => {
    const minimal = canonicalPayload({
      v: 1, deviceId: 'SHOP-AAAA-BBBB-CCCC', customer: 'س', plan: 'trial',
      features: [], issuedAt: '2026-10-08', expiresAt: null,
    })
    expect(minimal).toBe('{"v":1,"deviceId":"SHOP-AAAA-BBBB-CCCC","customer":"س","plan":"trial","features":[],"issuedAt":"2026-10-08","expiresAt":null}')
    expect(minimal).not.toContain('extraUsers')
    expect(minimal).not.toContain('activityId')
    expect(minimal).not.toContain('extraModules')

    const withZero = canonicalPayload({
      v: 1, deviceId: 'SHOP-AAAA-BBBB-CCCC', customer: 'س', plan: 'trial',
      features: [], issuedAt: '2026-10-08', expiresAt: null, extraUsers: 0, extraBranches: 0,
    })
    expect(withZero).toContain('"extraUsers":0')
    expect(withZero).toContain('"extraBranches":0')
  })

  it('التوقيع لا يتأثر بترتيب الميزات/الوحدات في الواجهة (يُرتَّب دائماً)', async () => {
    const a = await issueLicenseKey({ ...GOLDEN_PAYLOAD, features: ['multi_branch', 'telegram_bot'], extraModules: ['pos', 'inventory'] }, GOLDEN_PRIV)
    const b = await issueLicenseKey({ ...GOLDEN_PAYLOAD, features: ['telegram_bot', 'multi_branch'], extraModules: ['inventory', 'pos'] }, GOLDEN_PRIV)
    expect(a).toBe(b)
    expect(a).toBe(GOLDEN_KEY)
  })

  it('مفتاح مدى الحياة: expiresAt = null يدخل الصيغة صريحاً', async () => {
    const payload: LicensePayload = { ...GOLDEN_PAYLOAD, plan: 'lifetime', expiresAt: null }
    const key = await issueLicenseKey(payload, GOLDEN_PRIV)
    const canonical = canonicalPayload(payload)
    expect(canonical).toContain('"expiresAt":null')
    expect(() => encodeLicenseKey(payload, new Uint8Array(64))).not.toThrow()
    await expect(verifyLicenseKey(key, payload.deviceId, GOLDEN_PUB)).resolves.toMatchObject({ expiresAt: null })
  })
})

describe('قواعد الخطة والانتهاء', () => {
  it('expiresAfterDays: 0 أو null = مدى الحياة', () => {
    expect(expiresAfterDays(0)).toBeNull()
    expect(expiresAfterDays(null)).toBeNull()
    expect(expiresAfterDays(1, '2026-10-08')).toBe('2026-10-09')
    expect(expiresAfterDays(365, '2026-10-08')).toBe('2027-10-08')
    expect(expiresAfterDays(14, '2026-10-08')).toBe('2026-10-22')
  })

  it('معرّف الجهاز بالصيغة والأبجدية الصحيحة', () => {
    const bytes = new Uint8Array(12).fill(0)
    const id = generateDeviceId(bytes)
    expect(id).toMatch(/^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(id).toBe('SHOP-AAAA-AAAA-AAAA') // الحرف الأول من الأبجدية
    const random = new Uint8Array(12)
    crypto.getRandomValues(random)
    expect(generateDeviceId(random)).toMatch(/^SHOP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
  })

  it('حدود الخطط + الإضافات تُجمع كما في التطبيق', () => {
    expect(effectiveLimits({ v: 1, deviceId: 'x', customer: 'y', plan: 'basic', features: [], issuedAt: '', expiresAt: null }))
      .toEqual({ ...PLAN_LIMITS.basic })
    expect(effectiveLimits({ v: 1, deviceId: 'x', customer: 'y', plan: 'pro', features: [], issuedAt: '', expiresAt: null, extraUsers: 3, extraBranches: 2 }))
      .toEqual({ maxUsers: 8, maxBranches: 4, multiInstance: true })
  })

  it('قائمة الإبطال تعمل بالبصمة', () => {
    expect(isRevoked(GOLDEN_KEY, [GOLDEN_FP])).toBe(true)
    expect(isRevoked(GOLDEN_KEY, [])).toBe(false)
    expect(isRevoked(GOLDEN_KEY, ['deadbeef'])).toBe(false)
  })
})
