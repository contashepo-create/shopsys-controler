import { create } from 'zustand'
import { bridge, type CfNamespaceInfo, type SecretsPatch, type SecretsStatus } from '../data/bridge.ts'
import { loadBinding, saveBinding, type AppBinding } from '../core/settings.ts'

export type ServicesState = 'unknown' | 'ok' | 'missing' | 'error'
export type LicenseState = 'unknown' | 'ok' | 'missing' | 'error'

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
  licenseState: LicenseState
  servicesState: ServicesState
  namespaces: CfNamespaceInfo[]
  load(): Promise<void>
  checkKv(): Promise<void>
  discoverNamespaces(): Promise<CfNamespaceInfo[]>
  createNamespace(title: string): Promise<{ ok: boolean; id?: string; error?: string }>
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
  licenseState: 'unknown',
  servicesState: 'unknown',
  namespaces: [],

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

  /** فحص فوري للمساحتين — يفرّق بين «غير مضبوطة» و«مضبوطة لكن الطلب فشل» */
  checkKv: async () => {
    const one = async (ns: 'license' | 'services') => {
      const res = await bridge.cf.listKeys(ns, 'dev:', undefined)
      if (res.ok) return 'ok' as const
      if (res.code === 'ns_missing') return 'missing' as const
      // listKeys على مساحة الخدمات بمقدمة dev: قد تفشل لأسباب أخرى — جرّب مقدمة فارغة
      const retry = await bridge.cf.listKeys(ns, '', undefined)
      if (retry.ok) return 'ok' as const
      return retry.code === 'ns_missing' ? ('missing' as const) : ('error' as const)
    }
    const [licenseState, servicesState] = await Promise.all([one('license'), one('services')])
    set({ licenseState, servicesState })
  },

  discoverNamespaces: async () => {
    const res = await bridge.cf.namespaces()
    if (!res.ok) throw new Error(res.error ?? 'تعذر سرد المساحات')
    set({ namespaces: res.namespaces })
    return res.namespaces
  },

  createNamespace: async (title) => {
    const res = await bridge.cf.createNamespace(title)
    if (res.ok) {
      const list = await bridge.cf.namespaces()
      if (list.ok) set({ namespaces: list.namespaces })
    }
    return res.ok ? { ok: true, id: res.id } : { ok: false, error: res.error }
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
