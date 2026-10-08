/**
 * Dev launcher: starts Vite (renderer) then Electron pointing at it.
 * Usage: npm run desktop:dev
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)
const PORT = process.env.CONTROLER_PORT ?? '5174'
const URL = `http://localhost:${PORT}`

console.log('▶ تشغيل Vite…')
const vite = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', PORT, '--strictPort'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

async function waitForServer(url, timeoutMs = 60_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 700))
  }
  return false
}

const ready = await waitForServer(URL)
if (!ready) {
  console.error('✖ لم يبدأ خادم Vite خلال المهلة')
  vite.kill()
  process.exit(1)
}
console.log('▶ تشغيل Electron…')

let electronBin
try {
  electronBin = require('electron')
} catch {
  console.error('✖ حزمة electron غير مثبتة — نفّذ npm install أولاً')
  vite.kill()
  process.exit(1)
}

const electron = spawn(electronBin, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, CONTROLER_DEV_URL: URL },
})

electron.on('exit', (code) => {
  vite.kill()
  process.exit(code ?? 0)
})
