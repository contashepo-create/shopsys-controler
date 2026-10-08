#!/usr/bin/env node
/**
 * Secret guard — fails if anything that looks like a live credential is committed.
 * Checks every file in the repo except ignored/build dirs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

// جذر المستودع — fileURLToPath يعمل على ويندوز ولينكس بلا تعقيدات مسارات
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-desktop', 'release', 'out', 'coverage', '.vite', 'win-unpacked'])
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.ico', '.webp', '.woff', '.woff2', '.ttf', '.db', '.exe', '.zip'])

const PATTERNS = [
  { name: 'Telegram bot token', re: /\b\d{8,12}:[A-Za-z0-9_-]{33,}\b/ },
  { name: 'Cloudflare API token', re: /\b[A-Za-z0-9_-]{40}\b(?=[^\n]*cloudflare)/i },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
  { name: 'Stripe/OpenAI style key', re: /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{20,}\b/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'assigned secret assignment', re: /\b(?:api[_-]?token|bot[_-]?token|private[_-]?key|password)\s*[:=]\s*['"][^'"\n]{16,}['"]/i },
]

const ALLOW = [
  'mOugSh8oJdc5H6nB9mMTNQYjyXzYle2RJepQkob3msE', // public verification key — must be public
  '3ed24436e5844f3d9159b5b823cf9b65',             // KV namespace id — public in the bot's wrangler.toml
  '1234567890:',                                   // mask example in telegramAdmin.ts
]

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, files)
    else if (!SKIP_EXT.has(extname(entry).toLowerCase())) files.push(full)
  }
  return files
}

let failures = 0
let scanned = 0
for (const file of walk(ROOT)) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { continue }
  scanned += 1
  for (const { name, re } of PATTERNS) {
    const match = text.match(re)
    if (!match) continue
    const hit = match[0]
    if (ALLOW.some((a) => hit.includes(a))) continue
    const line = text.slice(0, match.index).split('\n').length
    console.error(`✖ ${relative(ROOT, file)}:${line} — ${name}: ${hit.slice(0, 12)}…`)
    failures += 1
  }
}

console.log(`\n🔐 فحص الأسرار: فُحص ${scanned} ملف — ${failures === 0 ? 'لا تسريبات ✓' : `${failures} ملاحظة ✖`}`)
process.exit(failures === 0 ? 0 : 1)
