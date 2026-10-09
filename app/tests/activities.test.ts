/**
 * النشاط: القائمة المنسدلة + الكتابة التلقائية لنشاط العميل كما اختاره + حفظ الاختيار عند الإصدار.
 */
import { describe, it, expect } from 'vitest'
import {
  ACTIVITY_CATALOG, activityLabel, activityDisplay, activityFromDevRecord,
  buildActivityOptions, normalizeActivityId, resolveClientActivity,
} from '../src/core/activities.ts'
import { buildCustomerViews, mergeDevRecord } from '../src/core/customers.ts'

describe('كتالوج الأنشطة', () => {
  it('معرّفات فريدة وصالحة ولكل نشاط اسم عربي', () => {
    const ids = ACTIVITY_CATALOG.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of ACTIVITY_CATALOG) {
      expect(normalizeActivityId(a.id)).toBe(a.id)
      expect(a.label.length).toBeGreaterThan(1)
    }
    expect(ids).toContain('grocery')
    expect(ids).toContain('pharmacy')
  })

  it('الاسم والعرض يسقطان إلى المعرّف للمجهول', () => {
    expect(activityLabel('pharmacy')).toBe('صيدلية')
    expect(activityLabel('bookstore')).toBe('bookstore')
    expect(activityLabel(null)).toBe('أي نشاط')
    expect(activityDisplay('pharmacy')).toBe('صيدلية (pharmacy)')
    expect(activityDisplay(null)).toBe('—')
  })

  it('normalizeActivityId لا يغيّر المعرّف (حالة الأحرف تُوقَّع كما هي) ويرفض غير الصالح', () => {
    expect(normalizeActivityId(' carParts ')).toBe('carParts')
    expect(normalizeActivityId('equipment_rental')).toBe('equipment_rental')
    expect(normalizeActivityId('two words')).toBeNull()
    expect(normalizeActivityId('a"b')).toBeNull()
    expect(normalizeActivityId('')).toBeNull()
    expect(normalizeActivityId('x'.repeat(65))).toBeNull()
    expect(normalizeActivityId(42)).toBeNull()
  })

  it('نشاط المفتاح الموقّع بحروف كبيرة يُعاد توقيعه كما هو عند التجديد', () => {
    expect(resolveClientActivity({ activityId: 'carParts' })).toEqual({ id: 'carParts', source: 'license' })
  })
})

describe('نشاط العميل كما اختاره', () => {
  it('يُقرأ من سجل الجهاز بأي اسم حقل معروف', () => {
    expect(activityFromDevRecord({ activityId: 'pharmacy' })).toBe('pharmacy')
    expect(activityFromDevRecord({ activity: 'laundry' })).toBe('laundry')
    expect(activityFromDevRecord({ requestedActivityId: 'clinic' })).toBe('clinic')
    expect(activityFromDevRecord({ plan: 'basic' })).toBeNull()
    expect(activityFromDevRecord(null)).toBeNull()
  })

  it('الأولوية: اختيار العميل ← نشاط المفتاح ← أي نشاط', () => {
    expect(resolveClientActivity({ clientActivityId: 'pharmacy', activityId: 'grocery' })).toEqual({ id: 'pharmacy', source: 'client' })
    expect(resolveClientActivity({ clientActivityId: null, activityId: 'grocery' })).toEqual({ id: 'grocery', source: 'license' })
    expect(resolveClientActivity({})).toEqual({ id: '', source: 'none' })
  })

  it('عرض العميل يحمل clientActivityId من dev:', () => {
    const views = buildCustomerViews({
      devEntries: [['SHOP-AAAA-BBBB-CCCC', JSON.stringify({ customer: 'صيدلية الشفاء', activityId: 'pharmacy' })]],
      licEntries: [], logEntries: [], emailEntries: [], chatEntries: [], revoked: [], todayIso: '2026-10-09',
    })
    expect(views[0].clientActivityId).toBe('pharmacy')
    expect(views[0].activityId).toBeNull()
  })
})

describe('خيارات القائمة المنسدلة', () => {
  it('الكتالوج + أنشطة العملاء المجهولة + القيم الإضافية بلا تكرار', () => {
    const opts = buildActivityOptions(
      [{ activityId: 'grocery', clientActivityId: 'bookstore' }, { activityId: 'bookstore' }],
      ['perfumes', 'grocery', null],
    )
    const values = opts.map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
    expect(values.slice(0, ACTIVITY_CATALOG.length)).toEqual(ACTIVITY_CATALOG.map((a) => a.id))
    expect(values).toContain('bookstore')
    expect(values).toContain('perfumes')
  })
})

describe('mergeDevRecord — الإصدار لا يمسح اختيار العميل', () => {
  const next = { plan: 'pro', expiresAt: '2027-10-09', customer: 'صيدلية الشفاء', fingerprint: 'abcd1234' }

  it('يحفظ نشاط العميل وحقول الـ worker ويزيل disabledAt', () => {
    const prev = JSON.stringify({ plan: 'basic', activityId: 'pharmacy', lastSeenAt: '2026-10-08T10:00:00Z', disabledAt: '2026-10-01', message: 'تم إيقاف الاشتراك' })
    const o = JSON.parse(mergeDevRecord(prev, next))
    expect(o).toMatchObject({ plan: 'pro', expiresAt: '2027-10-09', customer: 'صيدلية الشفاء', fingerprint: 'abcd1234', message: '', activityId: 'pharmacy', lastSeenAt: '2026-10-08T10:00:00Z' })
    expect(o.disabledAt).toBeUndefined()
  })

  it('النشاط الجديد (تغيير بطلب العميل) يُعتمد ليظهر في الإصدار القادم', () => {
    const o = JSON.parse(mergeDevRecord(JSON.stringify({ activityId: 'pharmacy' }), { ...next, activityId: 'clinic' }))
    expect(o.activityId).toBe('clinic')
  })

  it('سجل غير موجود أو تالف → سجل البوت المعتاد', () => {
    expect(JSON.parse(mergeDevRecord(null, next))).toEqual({ plan: 'pro', expiresAt: '2027-10-09', customer: 'صيدلية الشفاء', message: '', fingerprint: 'abcd1234' })
    expect(JSON.parse(mergeDevRecord('{تالف', next)).plan).toBe('pro')
  })
})
