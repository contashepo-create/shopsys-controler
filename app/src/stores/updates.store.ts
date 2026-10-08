import { create } from 'zustand'
import { bridge, type UpdateState } from '../data/bridge.ts'

interface UpdatesStore {
  state: UpdateState | null
  subscribed: boolean
  busy: boolean
  init(): void
  check(): Promise<{ ok: boolean; error?: string }>
  download(): Promise<{ ok: boolean; error?: string }>
  install(): Promise<{ ok: boolean; error?: string }>
}

const FALLBACK: UpdateState = { status: 'idle', version: null, percent: 0, error: null, currentVersion: '0.1.0' }

export const useUpdatesStore = create<UpdatesStore>((set, get) => ({
  state: null,
  subscribed: false,
  busy: false,

  /** يشترك مرة واحدة في بثّ حالة التحديث ويجلب الحالة الراهنة */
  init: () => {
    if (get().subscribed) return
    set({ subscribed: true })
    try {
      const off = bridge.updates.onState((s) => set({ state: s }))
      void off
    } catch { /* البديل الويب لا يدعم البث */ }
    void bridge.updates.state().then((s) => set({ state: s })).catch(() => set({ state: FALLBACK }))
  },

  check: async () => {
    set({ busy: true })
    try {
      const res = await bridge.updates.check()
      return res
    } finally {
      set({ busy: false })
    }
  },

  download: async () => {
    const res = await bridge.updates.download()
    return res
  },

  install: async () => {
    const res = await bridge.updates.install()
    return res
  },
}))
