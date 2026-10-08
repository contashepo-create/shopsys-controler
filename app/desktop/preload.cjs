/**
 * Preload — the ONLY surface the renderer sees.
 * Thin wrappers over ipcRenderer.invoke (channel allowlist), no secrets exposed.
 */
const { contextBridge, ipcRenderer } = require('electron')

const CHANNELS = [
  'app:version',
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

contextBridge.exposeInMainWorld('controlerDesktop', api)
