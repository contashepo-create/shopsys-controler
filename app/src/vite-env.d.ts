/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface Window {
  controlerDesktop?: Record<string, (...args: unknown[]) => Promise<unknown>>
}
