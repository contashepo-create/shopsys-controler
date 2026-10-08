/**
 * App settings schema — binding between the panel, the bot and the تَحَكَّم app,
 * plus validation for the Cloudflare identifiers.
 */

import { DEVELOPER_PUBLIC_KEY_B64U } from './license.ts'

/** Public (non-secret) binding to the تَحَكَّم app ecosystem. */
export interface AppBinding {
  licenseWorkerUrl: string
  servicesWorkerUrl: string
  /** Must match the constant compiled into the customer app. */
  developerPublicKey: string
}

export const DEFAULT_BINDING: AppBinding = {
  licenseWorkerUrl: 'https://shopsys-control.mobileshop2026.workers.dev',
  servicesWorkerUrl: 'https://shopsys-control.contashepo.workers.dev',
  developerPublicKey: DEVELOPER_PUBLIC_KEY_B64U,
}

/** SHOPSYS_CONTROL namespace id — public in tools/devbot/wrangler.toml (shopsys repo). */
export const LICENSE_NS_DEFAULT = '3ed24436e5844f3d9159b5b823cf9b65'

export const APP_NAME = 'مركز تحكم المطور'
export const APP_NAME_EN = 'Shopsys Controler'

const HEX32_RE = /^[0-9a-f]{32}$/

export function isValidCfAccountId(s: string): boolean {
  return HEX32_RE.test(s.trim())
}

export function isValidCfNamespaceId(s: string): boolean {
  return HEX32_RE.test(s.trim())
}

export function isHttpsUrl(s: string): boolean {
  try {
    return new URL(s.trim()).protocol === 'https:'
  } catch {
    return false
  }
}

export interface DeveloperProfile {
  name: string
  phone: string
  email: string
}

export function validateProfile(p: DeveloperProfile): string | null {
  if (!p.name.trim()) return 'الاسم مطلوب'
  if (p.phone.trim() && !/^[+0-9][0-9 -]{6,19}$/.test(p.phone.trim())) return 'رقم الهاتف غير صالح'
  if (p.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) return 'البريد الإلكتروني غير صالح'
  return null
}

const BINDING_STORAGE_KEY = 'controler:binding'

export function loadBinding(): AppBinding {
  try {
    const raw = localStorage.getItem(BINDING_STORAGE_KEY)
    if (!raw) return DEFAULT_BINDING
    const o = JSON.parse(raw) as Partial<AppBinding>
    return {
      licenseWorkerUrl: typeof o.licenseWorkerUrl === 'string' && isHttpsUrl(o.licenseWorkerUrl) ? o.licenseWorkerUrl : DEFAULT_BINDING.licenseWorkerUrl,
      servicesWorkerUrl: typeof o.servicesWorkerUrl === 'string' && isHttpsUrl(o.servicesWorkerUrl) ? o.servicesWorkerUrl : DEFAULT_BINDING.servicesWorkerUrl,
      developerPublicKey: typeof o.developerPublicKey === 'string' && o.developerPublicKey.length > 0 ? o.developerPublicKey : DEFAULT_BINDING.developerPublicKey,
    }
  } catch {
    return DEFAULT_BINDING
  }
}

export function saveBinding(b: AppBinding): void {
  localStorage.setItem(BINDING_STORAGE_KEY, JSON.stringify(b))
}
