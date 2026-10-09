/**
 * تطابق التوقيع بين الواجهة (src/core/license.ts) وموقِّع سطح المكتب (desktop/main.cjs).
 * أي اختلاف في ترتيب الحقول = مفاتيح يرفضها تطبيق العميل. نختبر مئات الحمولات العشوائية
 * (بذرة ثابتة — النتيجة قابلة للتكرار) بكل تركيبات الحقول الاختيارية.
 */
import { describe, it, expect } from 'vitest'
import {
  canonicalPayload, verifyLicenseKey, decodeLicenseKey, keyFingerprint, LICENSE_FEATURES, EXTRA_MODULES,
  type LicensePayload, type LicensePlan, type LicenseFeature,
} from '../src/core/license.ts'
import { finalFeatures, finalModules } from '../src/core/issueForm.ts'
import { desktopCanonical, createDesktopSigner } from './helpers/desktopSigner.ts'

/** مولّد عشوائي ثابت البذرة (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const PLANS: LicensePlan[] = ['trial', 'basic', 'pro', 'lifetime']
const ACTIVITIES = ['grocery', 'pharmacy', 'carParts', 'Équipement', 'محل_عطور', 'x-1']
const NAMES = ['بقالة النور — المنصورة', 'Pharmacy "Al Amal"', 'محل \\ رقم 5', 'Ali\nNewline', '🛒 سوبر ماركت', '']

function randomPayload(r: () => number): LicensePayload {
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)]
  const subset = <T,>(arr: readonly T[]) => arr.filter(() => r() < 0.4)
  const plan = pick(PLANS)
  const p: LicensePayload = {
    v: 1,
    deviceId: `SHOP-${Math.floor(r() * 9000 + 1000)}-ABCD-EF${Math.floor(r() * 90 + 10)}`,
    customer: pick(NAMES),
    plan,
    features: subset(LICENSE_FEATURES) as LicenseFeature[],
    issuedAt: '2026-10-09',
    expiresAt: plan === 'lifetime' ? null : `2027-0${Math.floor(r() * 9) + 1}-1${Math.floor(r() * 9)}`,
  }
  if (r() < 0.5) p.extraUsers = Math.floor(r() * 5)
  if (r() < 0.5) p.extraBranches = Math.floor(r() * 4)
  if (r() < 0.5) p.activityId = pick(ACTIVITIES)
  if (r() < 0.5) p.extraModules = subset(EXTRA_MODULES)
  return p
}

describe('تطابق canonicalPayload بين الواجهة وmain.cjs', () => {
  const desktop = desktopCanonical()

  it('500 حمولة عشوائية — نفس النص حرفاً بحرف', () => {
    const r = rng(20261009)
    for (let i = 0; i < 500; i++) {
      const p = randomPayload(r)
      expect(desktop(p), JSON.stringify(p)).toBe(canonicalPayload(p))
    }
  })

  it('ترتيب الميزات والأقسام لا يغيّر الحمولة (كلاهما يرتّب)', () => {
    const base = randomPayload(rng(1))
    const a = { ...base, features: ['telegram_bot', 'einvoice_eg'] as LicenseFeature[], extraModules: ['pos', 'cars', 'lab'] }
    const b = { ...base, features: ['einvoice_eg', 'telegram_bot'] as LicenseFeature[], extraModules: ['lab', 'pos', 'cars'] }
    expect(canonicalPayload(a)).toBe(canonicalPayload(b))
    expect(desktop(a)).toBe(desktop(b))
  })

  it('الحقل الاختياري بقيمة 0 يختلف عن غيابه (يدخل الحمولة) — في الطرفين', () => {
    const base = randomPayload(rng(2))
    delete base.extraUsers
    const withZero = { ...base, extraUsers: 0 }
    expect(canonicalPayload(withZero)).not.toBe(canonicalPayload(base))
    expect(desktop(withZero)).toBe(canonicalPayload(withZero))
  })
})

describe('توقيع حقيقي بموقِّع main.cjs ثم تحقق بنواة العميل', () => {
  const signer = createDesktopSigner()

  it('200 مفتاح عشوائي: التوقيع صحيح والحمولة المفكوكة مطابقة والجهاز مربوط', async () => {
    const r = rng(77)
    for (let i = 0; i < 200; i++) {
      const p = randomPayload(r)
      const res = signer.sign(JSON.stringify(p))
      expect(res.ok).toBe(true)
      const verified = await verifyLicenseKey(res.key!, p.deviceId, signer.publicKeyB64u)
      expect(canonicalPayload(verified)).toBe(canonicalPayload(p))
      // المعرّف والاسم يُحفظان حرفياً (حالة الأحرف والرموز العربية والتنصيص)
      expect(verified.activityId).toBe(p.activityId)
      expect(verified.customer).toBe(p.customer)
      await expect(verifyLicenseKey(res.key!, 'SHOP-OTHR-DEVC-0000', signer.publicKeyB64u)).rejects.toThrow(/لجهاز آخر/)
    }
  })

  it('العبث بأي بايت في الحمولة يُسقط التوقيع', async () => {
    const p = randomPayload(rng(3))
    p.plan = 'basic'
    const key = signer.sign(JSON.stringify(p)).key!
    const [prefix, body, sig] = key.split('.')
    const tampered = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LicensePayload
    tampered.plan = 'lifetime'
    const forged = `${prefix}.${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${sig}`
    await expect(verifyLicenseKey(forged, p.deviceId, signer.publicKeyB64u)).rejects.toThrow(/التوقيع غير صحيح/)
  })

  it('Ed25519 حتمي: نفس الحمولة = نفس المفتاح = نفس البصمة (أساس فحص تصادم المحروق)', () => {
    const p = randomPayload(rng(4))
    const k1 = signer.sign(JSON.stringify(p)).key!
    const k2 = signer.sign(JSON.stringify(p)).key!
    expect(k1).toBe(k2)
    expect(keyFingerprint(k1)).toMatch(/^[0-9a-f]{8}$/)
  })

  it('حمولة ناقصة تُرفض من الموقِّع', () => {
    expect(signer.sign(JSON.stringify({ v: 1, plan: 'basic' })).ok).toBe(false)
    expect(signer.sign('not json').ok).toBe(false)
  })

  it('حمولة نموذج الإصدار (ميزات/أقسام نهائية) تمر بالتوقيع والتحقق دون فقد', async () => {
    const features = finalFeatures(['cloud_sync', 'multi_branch', 'cloud_sync'], 'basic', 2)
    const modules = finalModules(['cars', 'pos', 'cars', 'futureModule'])
    const p: LicensePayload = {
      v: 1, deviceId: 'SHOP-AAAA-BBBB-CCCC', customer: 'x', plan: 'basic', features,
      issuedAt: '2026-10-09', expiresAt: '2027-10-09', extraBranches: 2, extraModules: modules,
    }
    const key = signer.sign(JSON.stringify(p)).key!
    const { payload } = decodeLicenseKey(key)
    expect(payload.features.sort()).toEqual(['cloud_sync', 'multi_branch'])
    expect(payload.extraModules).toEqual(['cars', 'futureModule', 'pos'])
  })
})
