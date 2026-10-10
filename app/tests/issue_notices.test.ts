/**
 * نموذج الإصدار الموحّد (الفروع/الأقسام/الافتراضيات) + سجل الإشعارات (تعديل/حذف/تتبع القراءة).
 */
import { describe, it, expect } from 'vitest'
import {
  finalFeatures, finalModules, splitModules, totalBranches, parseGlobalDefaults, defaultRenewDays, toCount,
} from '../src/core/issueForm.ts'
import { ACTIVITY_CATALOG, ACTIVITY_MODULES } from '../src/core/activities.ts'
import { EXTRA_MODULES } from '../src/core/license.ts'
import {
  buildNotice, collectSentNotices, editNoticeInList, removeNoticeFromList, parseNoticeList, parseNoticeReads,
  noticeRecipients, summarizeRecipients, resolveTargetDevices,
} from '../src/core/notices.ts'

describe('الفروع: حقل واحد يضبط «تعدد الفروع» تلقائياً', () => {
  it('تجريبي + 1 فرع إضافي = فرعان وتعدد الفروع مفعّل', () => {
    expect(totalBranches('trial', 1)).toBe(2)
    expect(finalFeatures(['telegram_bot'], 'trial', 1)).toEqual(['telegram_bot', 'multi_branch'])
  })
  it('بلا فروع إضافية في باقة بفرع واحد → تعدد الفروع يُزال حتى لو كان محدداً', () => {
    expect(finalFeatures(['multi_branch', 'cloud_sync'], 'basic', 0)).toEqual(['cloud_sync'])
  })
  it('toCount يتجاهل القيم السالبة والنصوص', () => {
    expect(toCount('2')).toBe(2)
    expect(toCount('-3')).toBe(0)
    expect(toCount('abc')).toBe(0)
    expect(toCount('')).toBe(0)
  })
})

describe('الأقسام: لا يُرسَل للعميل قسم موجود عنده', () => {
  it('أقسام النشاط وما يملكه لا تظهر في «يمكن إضافتها»', () => {
    const s = splitModules({ activityId: 'restaurant', owned: ['booking'] })
    expect(s.included).toContain('pos')
    expect(s.included).toContain('recipes')
    expect(s.owned).toEqual(['booking'])
    expect(s.addable).not.toContain('pos')
    expect(s.addable).not.toContain('booking')
    expect(s.addable).toContain('installments')
  })
  it('«إظهار كل الأقسام» يعرض أقسام النشاط للإضافة', () => {
    expect(splitModules({ activityId: 'grocery', owned: [], showAll: true }).addable).toContain('pos')
  })
  it('finalModules يزيل التكرار ويرتب قياسياً', () => {
    expect(finalModules(['pos', 'inventory', 'pos'])).toEqual(['pos', 'inventory'])
  })
  it('خريطة الأنشطة تستخدم معرّفات أقسام وأنشطة معروفة فقط', () => {
    const activityIds = new Set(ACTIVITY_CATALOG.map((a) => a.id))
    for (const [act, mods] of Object.entries(ACTIVITY_MODULES)) {
      expect(activityIds.has(act)).toBe(true)
      for (const m of mods) expect(EXTRA_MODULES).toContain(m)
    }
  })
})

describe('الافتراضيات (settings:global)', () => {
  it('تقرأ شكل البوت وتسقط للافتراضي عند التلف', () => {
    expect(parseGlobalDefaults(JSON.stringify({ plan: 'pro', days: 30, features: ['cloud_sync'], extraBranches: 1 })))
      .toMatchObject({ plan: 'pro', days: 30, features: ['cloud_sync'], extraBranches: 1, extraUsers: 0, extraModules: [] })
    expect(parseGlobalDefaults('{x').plan).toBe('basic')
    expect(parseGlobalDefaults(JSON.stringify({ plan: 'gold' })).plan).toBe('basic')
  })
  it('تعديل اشتراك قائم يبقي تاريخ الانتهاء كما هو', () => {
    expect(defaultRenewDays('2026-11-08', '2026-10-09')).toBe(30)
    expect(defaultRenewDays('2026-10-01', '2026-10-09')).toBe(365)
    expect(defaultRenewDays(null, '2026-10-09', 90)).toBe(90)
  })
})

describe('سجل الإشعارات: تعديل وحذف', () => {
  const now = new Date('2026-10-09T10:00:00Z')
  const a = buildNotice({ title: 'صيانة', body: 'سيتوقف السيرفر ساعة' }, now)
  const b = buildNotice({ title: 'عرض', body: 'خصم على الباقة الاحترافية' }, now)
  const lists = [
    ['notices:global', JSON.stringify([a])],
    ['notices:SHOP-AAAA-BBBB-CCCC', JSON.stringify([b])],
    ['notices:SHOP-DDDD-EEEE-FFFF', JSON.stringify([b])],
  ] as const

  it('يجمع إشعار المجموعة مرة واحدة بكل أجهزته', () => {
    const sent = collectSentNotices(lists)
    expect(sent).toHaveLength(2)
    const group = sent.find((s) => s.notice.id === b.id)!
    expect(group.scope).toBe('devices')
    expect(group.deviceIds).toEqual(['SHOP-AAAA-BBBB-CCCC', 'SHOP-DDDD-EEEE-FFFF'])
    expect(group.listKeys).toHaveLength(2)
    expect(sent.find((s) => s.notice.id === a.id)!.scope).toBe('global')
  })

  it('التعديل يحافظ على المعرّف ويضع editedAt', () => {
    const { raw, changed } = editNoticeInList(lists[1][1], b.id, { body: 'خصم 20%' }, now)
    expect(changed).toBe(true)
    const [n] = parseNoticeList(raw) as (typeof b & { editedAt?: string })[]
    expect(n.id).toBe(b.id)
    expect(n.body).toBe('خصم 20%')
    expect(n.title).toBe('عرض')
    expect(n.editedAt).toBe(now.toISOString())
    expect(editNoticeInList(lists[1][1], 'missing', { body: 'x' }).changed).toBe(false)
  })

  it('الحذف يزيل الإشعار فقط', () => {
    const both = JSON.stringify([a, b])
    const { raw, changed } = removeNoticeFromList(both, a.id)
    expect(changed).toBe(true)
    expect(parseNoticeList(raw).map((n) => n.id)).toEqual([b.id])
  })
})

describe('تتبع القراءة', () => {
  const sentAt = '2026-10-09T10:00:00.000Z'
  const n = { ...buildNotice({ body: 'تحديث جديد متاح' }, new Date(sentAt)) }
  const customers = [
    { deviceId: 'SHOP-AAAA-BBBB-CCCC', customer: 'بقالة النور', lastSeenAt: '2026-10-09T12:00:00Z' },
    { deviceId: 'SHOP-DDDD-EEEE-FFFF', customer: 'صيدلية الشفاء', lastSeenAt: '2026-10-09T11:00:00Z' },
    { deviceId: 'SHOP-GGGG-HHHH-IIII', customer: 'مطعم', lastSeenAt: '2026-10-08T09:00:00Z' },
  ]

  it('يقرأ إيصالات القراءة بأشكالها', () => {
    expect(parseNoticeReads(JSON.stringify({ x: '2026-10-09T12:00:00Z' }))).toEqual({ x: '2026-10-09T12:00:00Z' })
    expect(parseNoticeReads(JSON.stringify(['x', { id: 'y', at: 't' }]))).toEqual({ x: '', y: 't' })
    expect(parseNoticeReads('{bad')).toEqual({})
  })

  it('قرأه / وصله / لم يصله', () => {
    const sent = collectSentNotices([['notices:global', JSON.stringify([n])]])[0]
    const reads = new Map([['SHOP-AAAA-BBBB-CCCC', { [n.id]: '2026-10-09T12:05:00Z' }]])
    const list = noticeRecipients(sent, customers, reads)
    expect(list.map((r) => r.state)).toEqual(['read', 'delivered', 'pending'])
    expect(list[0].at).toBe('2026-10-09T12:05:00Z')
    expect(summarizeRecipients(list)).toEqual({ read: 1, delivered: 1, pending: 1, total: 3 })
  })

  it('استهداف النشاط يستخدم اختيار العميل أولاً', () => {
    const cs = [
      { deviceId: 'A', activityId: 'grocery', clientActivityId: 'pharmacy' },
      { deviceId: 'B', activityId: 'pharmacy', clientActivityId: null },
    ]
    expect(resolveTargetDevices({ type: 'activity', activityId: 'pharmacy' }, cs as never)).toEqual({ mode: 'devices', deviceIds: ['A', 'B'] })
  })
})

import { describeTargeting } from '../src/core/notices.ts'

describe('describeTargeting — اسم النشاط بدل المعرّف', () => {
  it('يعرض الاسم العربي للنشاط المعروف والمعرّف كما هو لغير المعروف', () => {
    expect(describeTargeting({ type: 'activity', activityId: 'grocery' }, [])).toContain('أغذية / سوبر ماركت')
    expect(describeTargeting({ type: 'activity', activityId: 'customX' }, [])).toContain('customX')
  })
})
