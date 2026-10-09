/**
 * Local audit log — every sensitive action is recorded (append-only, in the
 * local SQLite DB via the Electron main process). Nothing sensitive is logged:
 * no tokens, no keys, no full license keys (fingerprints only).
 */

export type AuditAction =
  | 'license_issue'
  | 'license_renew'
  | 'license_revoke'
  | 'customer_activate'
  | 'customer_deactivate'
  | 'feature_update'
  | 'flag_disable'
  | 'flag_enable'
  | 'notice_send'
  | 'notice_edit'
  | 'notice_delete'
  | 'license_send'
  | 'about_update'
  | 'version_update'
  | 'settings_global_update'
  | 'support_reply'
  | 'password_change'
  | 'password_reset'
  | 'key_import'
  | 'profile_update'
  | 'cf_settings_update'
  | 'bot_settings_update'

export interface AuditEntry {
  action: AuditAction
  /** e.g. deviceId or fingerprint — never a secret */
  target?: string
  details?: Record<string, unknown>
  at: string
}

export const AUDIT_ACTION_LABELS_AR: Record<AuditAction, string> = {
  license_issue: 'إصدار مفتاح',
  license_renew: 'تجديد مفتاح',
  license_revoke: 'حرق مفتاح',
  customer_activate: 'تنشيط عميل',
  customer_deactivate: 'تعطيل عميل',
  feature_update: 'تعديل ميزات/أقسام',
  flag_disable: 'إطفاء ميزة سحابية',
  flag_enable: 'تفعيل ميزة سحابية',
  notice_send: 'إرسال إشعار',
  notice_edit: 'تعديل إشعار',
  notice_delete: 'حذف إشعار',
  license_send: 'إرسال المفتاح للعميل',
  about_update: 'تحديث «حول»',
  version_update: 'نشر تحديث',
  settings_global_update: 'تحديث الإعدادات العامة',
  support_reply: 'رد على دعم',
  password_change: 'تغيير كلمة المرور',
  password_reset: 'إعادة تعيين كلمة المرور',
  key_import: 'استيراد المفتاح الخاص',
  profile_update: 'تحديث الحساب',
  cf_settings_update: 'تحديث إعدادات Cloudflare',
  bot_settings_update: 'تحديث إعدادات البوت',
}

export function describeAudit(entry: AuditEntry): string {
  const label = AUDIT_ACTION_LABELS_AR[entry.action] ?? entry.action
  const target = entry.target ? ` — ${entry.target}` : ''
  return `${label}${target}`
}

/** Keep details free of secrets: only these fields may be stored. */
export function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(details)) {
    const kl = k.toLowerCase()
    if (kl.includes('token') || kl.includes('secret') || kl.includes('key') || kl.includes('password') || kl.includes('private')) continue
    if (typeof v === 'string' && v.length > 200) {
      out[k] = v.slice(0, 200) + '…'
      continue
    }
    out[k] = v
  }
  return out
}
