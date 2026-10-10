/**
 * انحدار: بصمة المفتاح المُلدَّن (malleable) يجب أن تطابق بصمة المفتاح الأصلي.
 * التوقيع Ed25519 يقبل تغيير حشو الحرف الأخير من التوقيع؛ التطبيق يطبّع البصمة (ح1)،
 * فلو لم تطبّعها اللوحة لا يُبطل حرق البصمة المفتاح الأصلي عند العميل.
 */
import { describe, it, expect } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { b64uEncode, issueLicenseKey, keyFingerprint, verifyLicenseKey, type LicensePayload } from '../src/core/license.ts'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

describe('بصمة المفتاح المُلدَّن (ح1)', () => {
  it('المفتاح المُلدَّن (نفس البايتات، حشو مختلف) له البصمة نفسها ويُقبل عند التحقق', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const privB64u = b64uEncode(new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs8' })))
    const raw = publicKey.export({ format: 'der', type: 'spki' })
    const pubB64u = b64uEncode(new Uint8Array(raw.subarray(raw.length - 32)))
    const deviceId = 'SHOP-AAAA-BBBB-CCCC'
    const payload: LicensePayload = {
      v: 1, deviceId, customer: 'محل', plan: 'basic', features: ['telegram_bot'],
      issuedAt: '2026-10-10', expiresAt: '2027-10-10',
    }
    const key = await issueLicenseKey(payload, privB64u)
    const parts = key.split('.')
    const sig = parts[2]
    // تغيير آخر حرف في التوقيع (bits إضافية في حشوة base64url) مع بقاء البايتات نفسها
    const idx = B64.indexOf(sig.at(-1) as string)
    const malleated = [parts[0], parts[1], sig.slice(0, -1) + B64[idx ^ 15]].join('.')
    expect(malleated).not.toBe(key)

    expect(keyFingerprint(malleated)).toBe(keyFingerprint(key))
    // التحقق يقبل المُلدَّن (كما يفعل التطبيق) — وإلا فالبصمة تُفتعَل لمفتاح لا يعمل أصلاً
    await expect(verifyLicenseKey(malleated, deviceId, pubB64u)).resolves.toMatchObject({ deviceId })
  })
})
