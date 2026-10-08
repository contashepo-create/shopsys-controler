import { create } from 'zustand'
import { bridge, type SecretsPatch, type SecretsStatus } from '../data/bridge.ts'
import { loadBinding, saveBinding, type AppBinding } from '../core/settings.ts'

interface ConfigState {
  loaded: boolean
  cfAccountId: string
  cfNsLicense: string
  cfNsServices: string
  hasCfToken: boolean
  hasBotToken: boolean
  hasPrivateKey: boolean
  publicKeyMatches: boolean
  adminChatId: string
  botUsername: string | null
  binding: AppBinding
  load(): Promise<void>
  saveSecrets(p: SecretsPatch): Promise<void>
  refreshBot(): Promise<void>
  saveBinding(b: AppBinding): void
}

function fromStatus(s: SecretsStatus): Partial<ConfigState> {
  return {
    cfAccountId: s.cfAccountId,
    cfNsLicense: s.cfNsLicense,
    cfNsServices: s.cfNsServices,
    hasCfToken: s.hasCfToken,
    hasBotToken: s.hasBotToken,
    hasPrivateKey: s.hasPrivateKey,
    publicKeyMatches: s.publicKeyMatches,
    adminChatId: s.adminChatId,
  }
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  loaded: false,
  cfAccountId: '',
  cfNsLicense: '',
  cfNsServices: '',
  hasCfToken: false,
  hasBotToken: false,
  hasPrivateKey: false,
  publicKeyMatches: false,
  adminChatId: '',
  botUsername: null,
  binding: loadBinding(),

  load: async () => {
    const status = await bridge.secrets.status()
    set({ ...fromStatus(status), loaded: true })
    if (status.hasBotToken) {
      const me = await bridge.tg.getMe()
      if (me.ok) set({ botUsername: me.username ?? null })
    }
  },

  saveSecrets: async (p) => {
    await bridge.secrets.set(p)
    await get().load()
  },

  refreshBot: async () => {
    const me = await bridge.tg.getMe()
    if (me.ok) set({ botUsername: me.username ?? null })
    else set({ botUsername: null })
  },

  saveBinding: (b) => {
    saveBinding(b)
    set({ binding: b })
  },
}))
