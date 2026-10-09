import { create } from 'zustand'
import { bridge } from '../data/bridge.ts'
import type { DeveloperProfile } from '../core/settings.ts'

export type SessionStatus = 'loading' | 'setup' | 'locked' | 'unlocked'

interface SessionState {
  status: SessionStatus
  profile: DeveloperProfile | null
  theme: 'dark' | 'light'
  init(): Promise<void>
  unlock(): void
  lock(): void
  setProfile(p: DeveloperProfile): void
  setTheme(t: 'dark' | 'light'): void
}

const THEME_KEY = 'controler:theme'

export const useSessionStore = create<SessionState>((set) => ({
  status: 'loading',
  profile: null,
  theme: (() => {
    try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark' } catch { return 'dark' }
  })(),

  init: async () => {
    try {
      const [complete, profile] = await Promise.all([bridge.setup.isComplete(), bridge.profile.get()])
      // الإعداد فقط عند غياب كلمة المرور: لو وُجدت كلمة مرور بلا ملف حساب (حُذف مثلاً) فالقفل أولاً —
      // العملية الرئيسية ترفض تعيين كلمة مرور جديدة واللوحة مقفلة، والحساب يُكمل من الإعدادات بعد الدخول
      if (!complete.hasPassword) {
        set({ status: 'setup', profile })
        return
      }
      set({ status: 'locked', profile })
    } catch {
      set({ status: 'setup', profile: null })
    }
  },

  unlock: () => set({ status: 'unlocked' }),
  lock: () => {
    // العملية الرئيسية تقفل أيضاً: التوقيع والأسرار وCloudflare تُرفض حتى إدخال كلمة المرور
    void bridge.auth.lock().catch(() => {})
    set({ status: 'locked' })
  },
  setProfile: (p) => set({ profile: p }),
  setTheme: (t) => {
    try { localStorage.setItem(THEME_KEY, t) } catch { /* ignore */ }
    set({ theme: t })
  },
}))

/** Apply the theme class on <html> whenever it changes. */
export function applyTheme(theme: 'dark' | 'light'): void {
  const root = document.documentElement
  root.classList.toggle('light', theme === 'light')
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

export function currentProfile(): DeveloperProfile | null {
  return useSessionStore.getState().profile
}

