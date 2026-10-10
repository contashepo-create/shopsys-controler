/**
 * مدة المفتاح: «0» = مدى الحياة صراحة، والفارغ/الفاسد = 365 (لا مفتاح بلا انتهاء بالخطأ).
 * تاريخ الانتهاء المحدد يُحوَّل إلى أيام من اليوم، واليوم أو الماضي مرفوض.
 */
import { describe, it, expect } from 'vitest'
import { durationDays, daysUntil } from '../src/core/issueForm.ts'
import { expiresAfterDays } from '../src/core/license.ts'

describe('durationDays', () => {
  it('0 صراحة = مدى الحياة (يطابق البوت: expiresAfterDays(0) = null)', () => {
    expect(durationDays('0')).toBe(0)
    expect(expiresAfterDays(durationDays('0'), '2026-10-10')).toBeNull()
  })
  it('الأرقام الموجبة كما هي', () => {
    expect(durationDays('90')).toBe(90)
    expect(durationDays(' 365 ')).toBe(365)
  })
  it('الفارغ أو غير الرقمي أو السالب = 365 (ولا يتحول إلى مدى الحياة)', () => {
    expect(durationDays('')).toBe(365)
    expect(durationDays('abc')).toBe(365)
    expect(durationDays('-5')).toBe(365)
    expect(durationDays('1e3')).toBe(365)
    expect(durationDays(undefined)).toBe(365)
  })
})

describe('daysUntil', () => {
  it('تاريخ مستقبلي ⇒ عدد الأيام بالضبط', () => {
    expect(daysUntil('2026-10-10', '2027-01-08')).toBe(90)
  })
  it('اليوم أو الماضي أو صيغة خاطئة ⇒ null', () => {
    expect(daysUntil('2026-10-10', '2026-10-10')).toBeNull()
    expect(daysUntil('2026-10-10', '2026-10-01')).toBeNull()
    expect(daysUntil('2026-10-10', '')).toBeNull()
    expect(daysUntil('2026-10-10', '2027-13-45x')).toBeNull()
  })
  it('الذهاب والإياب: التاريخ الناتج من expiresAfterDays يعطي نفس الأيام', () => {
    const date = expiresAfterDays(120, '2026-10-10')!
    expect(daysUntil('2026-10-10', date)).toBe(120)
  })
})
