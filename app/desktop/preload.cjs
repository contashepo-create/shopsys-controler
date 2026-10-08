/**
 * Preload — the ONLY surface the renderer sees.
 * Thin wrappers over ipcRenderer.invoke (channel allowlist), no secrets exposed.
 */
const { contextBridge, ipcRenderer } = require('electron')

const CHANNELS = [
  'app:version',
  'update:state',
  'update:check',
  'update:download',
  'update:install',
  'setup:isComplete',
  'profile:get',
  'profile:save',
  'auth:setPassword',
  'auth:verifyPassword',
  'secrets:status',
  'secrets:set',
  'cf:request',
  'cf:test',
  'cf:namespaces',
  'cf:namespaceCreate',
  'tg:send',
  'tg:getMe',
  'license:sign',
  'license:checkKey',
  'db:auditAppend',
  'db:auditList',
  'db:cacheGet',
  'db:cachePut',
  'shell:openExternal',
]

const api = {}
for (const channel of CHANNELS) {
  api[channel] = (...args) => ipcRenderer.invoke(channel, ...args)
}

// بثّ حالة التحديث من العملية الرئيسية إلى الواجهة (يعيد دالة إلغاء الاشتراك)
api.onUpdateState = (callback) => {
  const listener = (_event, state) => { try { callback(state) } catch { /* ignore */ } }
  ipcRenderer.on('update:state', listener)
  return () => ipcRenderer.removeListener('update:state', listener)
}

contextBridge.exposeInMainWorld('controlerDesktop', api)
