#!/usr/bin/env node
/**
 * verify:all — البوابة الكاملة قبل أي دفعة (نفس عادة مشروع تَحَكَّم).
 *   ① فحص الأسرار (لا توكنات ولا مفاتيح خاصة في git)
 *   ② فحص نواة الترخيص (المتجه الذهبي + التوافق مع البوت)
 *   ③ فحص الأنواع TypeScript
 *   ④ اختبارات الوحدة (vitest)
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

const steps = [
  { name: 'فحص الأسرار', cmd: [process.execPath, 'scripts/verify_no_secrets.mjs'] },
  { name: 'نواة الترخيص', cmd: [process.execPath, '--experimental-strip-types', 'scripts/verify_license_core.mjs'] },
  { name: 'فحص الأنواع', cmd: ['npx', 'tsc', '-b', '--force'] },
  { name: 'اختبارات الوحدة', cmd: ['npx', 'vitest', 'run'] },
]

let failed = 0
for (const step of steps) {
  console.log(`\n▶ ${step.name}…`)
  const res = spawnSync(step.cmd[0], step.cmd.slice(1), { stdio: 'inherit', cwd: APP_DIR, shell: process.platform === 'win32' })
  if (res.status !== 0) {
    console.error(`✖ فشل: ${step.name}`)
    failed += 1
  }
}

console.log(failed === 0 ? '\n✅ كل الفحوص نجحت — جاهز للدفعة\n' : `\n❌ ${failed} فحص فشل\n`)
process.exit(failed === 0 ? 0 : 1)
