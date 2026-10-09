/**
 * الموقِّع الحقيقي من desktop/main.cjs — نستخرج دوال التوقيع نصّاً من الملف ونشغّلها
 * بمفتاح Ed25519 مؤقت، حتى تختبر الاختبارات نفس الكود الذي يوقّع في نسخة سطح المكتب
 * (وليس نسخة مكررة منه قد تختلف عنه بصمت).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import nodeCrypto from 'node:crypto'

// توحيد نهايات الأسطر: مشغّل Windows في CI يسحب الملفات بـ CRLF (core.autocrlf)
const MAIN_CJS = readFileSync(join(import.meta.dirname, '..', '..', 'desktop', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n')

/** يستخرج نص دالة من main.cjs (من «function name(» حتى أول «}» في بداية سطر). */
/** يستخرج سطر ثابت «const NAME = ...» من main.cjs. */
export function extractConst(name: string): string {
  const m = MAIN_CJS.match(new RegExp(`^const ${name} = .*$`, 'm'))
  if (!m) throw new Error(`لم أجد الثابت ${name} في main.cjs`)
  return m[0]
}

export function extractFunction(name: string): string {
  const start = MAIN_CJS.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`لم أجد الدالة ${name} في main.cjs`)
  const end = MAIN_CJS.indexOf('\n}\n', start)
  if (end < 0) throw new Error(`نهاية الدالة ${name} غير موجودة`)
  return MAIN_CJS.slice(start, end + 2)
}

type AnyFn = (...a: unknown[]) => unknown

/** canonicalPayload كما في main.cjs بالضبط. */
export function desktopCanonical(): (p: unknown) => string {
  return new Function(`${extractFunction('canonicalPayload')}\nreturn canonicalPayload`)() as (p: unknown) => string
}

export interface TestSigner {
  /** نفس عقد bridge.license.sign */
  sign(payloadJson: string): { ok: boolean; key?: string; error?: string }
  publicKeyB64u: string
}

export function createDesktopSigner(): TestSigner {
  const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ed25519')
  const raw = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  const publicKeyB64u = raw.subarray(raw.length - 32).toString('base64url')
  const factory = new Function(
    'crypto', 'Buffer', 'privateKeyObject',
    `${extractConst('B64U')}\n${extractFunction('bufferToB64u')}\n${extractFunction('canonicalPayload')}\n${extractFunction('handleLicenseSign')}\nreturn handleLicenseSign`,
  ) as (c: typeof nodeCrypto, b: typeof Buffer, pk: () => unknown) => AnyFn
  const handle = factory(nodeCrypto, Buffer, () => privateKey)
  return { sign: (json) => handle(json) as { ok: boolean; key?: string; error?: string }, publicKeyB64u }
}
