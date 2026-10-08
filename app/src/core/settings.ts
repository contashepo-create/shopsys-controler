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


/* ─── مساحات KV: الاكتشاف والمطابقة ─── */

export interface CfNamespaceInfo {
  id: string
  title: string
}

export type NamespaceRole = 'license' | 'services'

export interface RoleSuggestion {
  role: NamespaceRole
  namespaceId: string | null
  /** exact = الاسم الرسمي المطابق، guess = ترجيح، none = لم يُعثر */
  confidence: 'exact' | 'guess' | 'none'
  reasonAr: string
}

/** العنوان المتوقع لكل دور (كما في مستودع تَحَكَّم) */
export const EXPECTED_NS_TITLES: Record<NamespaceRole, string> = {
  license: 'SHOPSYS_CONTROL',
  services: 'SHOPSYS_KV',
}

export const ROLE_LABELS_AR: Record<NamespaceRole, string> = {
  license: 'مساحة التراخيص',
  services: 'مساحة الخدمات',
}

export const ROLE_PURPOSE_AR: Record<NamespaceRole, string> = {
  license: 'التراخيص والعملاء والإشعارات ومحتوى «حول»',
  services: 'الدعم والأعلام السحابية وبطاقات الاشتراك ونشر التحديثات',
}

function normalizeTitle(t: string): string {
  return t.trim().toUpperCase().replace(/[-\s]+/g, '_')
}

/**
 * ترشيح دور لكل مساحة من مساحات الحساب.
 * القواعد: الاسم الرسمي (SHOPSYS_CONTROL / SHOPSYS_KV) ثم أي اسم يحتوي الكلمة المميزة،
 * ثم — لو بقيت مساحة واحدة غير مُختارة — تُرشَّح للدور الفارغ الوحيد.
 */
export function suggestNamespaceRoles(
  all: readonly CfNamespaceInfo[],
  current: { license?: string; services?: string } = {},
): RoleSuggestion[] {
  const taken = new Set<string>()
  const out: RoleSuggestion[] = []

  const pick = (role: NamespaceRole, exactTitle: string, marker: string): RoleSuggestion => {
    const cur = (role === 'license' ? current.license : current.services) ?? ''
    if (cur) {
      const hit = all.find((n) => n.id === cur)
      taken.add(cur)
      return { role, namespaceId: cur, confidence: 'exact', reasonAr: hit ? `مضبوطة حالياً (${hit.title})` : 'مضبوطة حالياً' }
    }
    const exact = all.find((n) => !taken.has(n.id) && normalizeTitle(n.title) === normalizeTitle(exactTitle))
    if (exact) {
      taken.add(exact.id)
      return { role, namespaceId: exact.id, confidence: 'exact', reasonAr: `الاسم مطابق: ${exact.title}` }
    }
    const partial = all.find((n) => !taken.has(n.id) && normalizeTitle(n.title).includes(marker))
    if (partial) {
      taken.add(partial.id)
      return { role, namespaceId: partial.id, confidence: 'guess', reasonAr: `ترجيح من الاسم: ${partial.title}` }
    }
    return { role, namespaceId: null, confidence: 'none', reasonAr: `لم أجد مساحة باسم ${exactTitle}` }
  }

  out.push(pick('license', 'SHOPSYS_CONTROL', 'CONTROL'))
  out.push(pick('services', 'SHOPSYS_KV', 'KV'))

  // لو بقيت مساحة واحدة حرّة ودور واحد فارغ ⇒ رشّحها له
  // (التراخيص أولاً لأنها المساحة الأساسية التي بلاها لا تعمل اللوحة)
  const free = all.filter((n) => !taken.has(n.id))
  if (free.length === 1) {
    const emptyLicense = out.find((r) => r.role === 'license' && r.namespaceId == null)
    const empty = emptyLicense ?? out.find((r) => r.namespaceId == null)
    if (empty) {
      empty.namespaceId = free[0].id
      empty.confidence = 'guess'
      empty.reasonAr = `المساحة الوحيدة المتاحة في الحساب: ${free[0].title}`
    }
  }
  return out
}

/** تعليمات الربط التي تُعرض للمالك عند إنشاء مساحة الخدمات (تُطبَّق في مستودع تَحَكَّم) */
export function servicesBindingSnippet(namespaceId: string): string {
  return [
    '# في مستودع shopsys — الملف cloud/wrangler.toml',
    '[[kv_namespaces]]',
    'binding = "SHOPSYS_KV"',
    `id = "${namespaceId}"`,
    '',
    '# ثم النشر:',
    'cd cloud && npx wrangler deploy',
  ].join('\n')
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
