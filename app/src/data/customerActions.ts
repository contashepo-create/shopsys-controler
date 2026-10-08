/**
 * Customer-level operations: activate / deactivate, issue & renew — the panel's
 * equivalents of the bot's /اصدر and /حرق. Everything is written with the same
 * KV shapes so the bot and the customer app keep working unchanged.
 */

import { bridge } from './bridge.ts'
import { issueLicense, revokeLicense, type IssueLicenseInput, type IssueLicenseResult } from './actions.ts'
import { appendDeviceLogEntry, type CustomerView } from '../core/customers.ts'
import type { LicenseFeature, LicensePlan } from '../core/license.ts'

export interface QuickIssueInput {
  deviceId: string
  customer: string
  plan: LicensePlan
  days: number
  activityId?: string
  extraUsers?: number
  extraBranches?: number
  features: LicenseFeature[]
  extraModules?: string[]
}

/** Activate (or re-activate) a customer: issue a fresh key. */
export async function activateCustomer(input: QuickIssueInput): Promise<IssueLicenseResult> {
  return issueLicense(input as IssueLicenseInput)
}

/** Renew = issue a new key on top of the existing device. */
export async function planAndRenewCustomer(input: QuickIssueInput): Promise<IssueLicenseResult> {
  return issueLicense(input as IssueLicenseInput, { renew: true })
}

/**
 * Deactivate a customer: burn the current fingerprint (both namespaces) and
 * mark the device record. The app refuses the key after its next sync.
 */
export async function deactivateCustomer(c: CustomerView): Promise<void> {
  if (!c.fingerprint) throw new Error('لا توجد بصمة مفتاح لهذا العميل — أعد إصدار مفتاح أولاً')
  await revokeLicense(c.fingerprint)
  const logKey = `log:${c.deviceId}`
  const prev = await bridge.cf.get('license', logKey)
  await bridge.cf.put('license', logKey, appendDeviceLogEntry(prev.ok ? prev.value : null, 'تعطيل من اللوحة (حرق المفتاح)'))
  const dev = await bridge.cf.get('license', `dev:${c.deviceId}`)
  if (dev.ok && dev.value) {
    try {
      const o = JSON.parse(dev.value) as Record<string, unknown>
      o.disabledAt = new Date().toISOString()
      o.message = 'تم إيقاف الاشتراك — تواصل مع المطوّر'
      await bridge.cf.put('license', `dev:${c.deviceId}`, JSON.stringify(o))
    } catch { /* keep going */ }
  }
}

/** Issue a key for an existing device (used by the customer card). */
export const issueForKey = issueLicense

export { issueLicense }
