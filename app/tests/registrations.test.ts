import { describe, it, expect } from 'vitest'
import { parseRegistrationRecord, filterRegistrations, hasLicense, platformLabelAr } from '../src/core/registrations.ts'

describe('registrations — parseRegistrationRecord', () => {
  it('يُحلّل سجل كامل ويتعامل مع الحقول المفقودة', () => {
    const raw = JSON.stringify({
      deviceId: 'SHOP-AAAA-BBBB-CCCC',
      shopName: 'محل النور',
      ownerName: 'أحمد',
      phone: '01012345678',
      email: 'a@b.co',
      city: 'المنصورة',
      street: 'شارع البحر',
      activityNameAr: 'سوبر ماركت',
      registeredAt: '2026-10-24T10:00:00Z',
      firstSeenAt: '2026-10-24T10:00:00Z',
      lastSeenAt: '2026-10-24T10:05:00Z',
      reports: 1,
      activityId: 'grocery',
      platform: 'desktop',
    })
    const rec = parseRegistrationRecord(raw)!
    expect(rec.deviceId).toBe('SHOP-AAAA-BBBB-CCCC')
    expect(rec.shopName).toBe('محل النور')
    expect(rec.phone).toBe('01012345678')
    expect(rec.activityId).toBe('grocery')
    expect(rec.reports).toBe(1)
  })

  it('يرفض معرّف جهاز غير صالح', () => {
    expect(parseRegistrationRecord(JSON.stringify({ deviceId: 'BAD' }))).toBeNull()
    expect(parseRegistrationRecord('not json')).toBeNull()
    expect(parseRegistrationRecord(null)).toBeNull()
  })

  it('يتسامح مع حقول تالفة ويُنقّي النصوص', () => {
    const raw = JSON.stringify({
      deviceId: 'SHOP-XXXX-YYYY-ZZZZ',
      shopName: '  متجر <script>  ',
      phone: '010 123',
      email: 'not-an-email',
      pendingChanges: { shopName: 'اسم جديد', phone: '0111111111' },
      pendingAt: '2026-10-24T11:00:00Z',
    })
    const rec = parseRegistrationRecord(raw)!
    expect(rec.shopName).toBe('متجر script') // <> مُزالة
    expect(rec.email).toBe('') // بريد تالف يُفرغ
    expect(rec.pendingChanges).toEqual({ shopName: 'اسم جديد', phone: '0111111111' })
  })

  it('hasLicense يميّز سجل بلا رخصة', () => {
    expect(hasLicense({ plan: '' })).toBe(false)
    expect(hasLicense({ plan: 'pro' })).toBe(true)
    expect(hasLicense(null)).toBe(false)
    expect(hasLicense({})).toBe(false)
  })

  it('platformLabelAr', () => {
    expect(platformLabelAr('desktop')).toBe('سطح المكتب')
    expect(platformLabelAr('web')).toBe('المتصفح')
    expect(platformLabelAr(undefined)).toBe('—')
  })

  it('فلترة بالبحث', () => {
    const list = [
      { deviceId: 'SHOP-AAAA-BBBB-CCCC', shopName: 'محل النور', ownerName: 'أحمد', phone: '0101', email: '', city: 'المنصورة', street: '', activityNameAr: 'سوبر ماركت', registeredAt: '', firstSeenAt: '', lastSeenAt: '', reports: 1 } as any,
      { deviceId: 'SHOP-XXXX-YYYY-ZZZZ', shopName: 'صيدلية الشفاء', ownerName: 'محمد', phone: '0111', email: '', city: 'القاهرة', street: '', activityNameAr: 'صيدلية', registeredAt: '', firstSeenAt: '', lastSeenAt: '', reports: 1 } as any,
    ]
    expect(filterRegistrations(list, 'النور')).toHaveLength(1)
    expect(filterRegistrations(list, '0111')).toHaveLength(1)
    expect(filterRegistrations(list, '')).toHaveLength(2)
    expect(filterRegistrations(list, 'SHOP-AAAA')).toHaveLength(1)
  })
})
