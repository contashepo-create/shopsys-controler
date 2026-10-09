/**
 * اختبارات شاملة للمنطق النقي: كل التركيبات بدل أمثلة منتقاة.
 *  • نموذج الإصدار: كل باقة × كل عدد فروع × كل مجموعة ميزات
 *  • تقسيم الأقسام: كل نشاط × مجموعات عشوائية من الأقسام المملوكة
 *  • مدخلات تالفة/عدائية: لا انهيار أبداً
 */
import { describe, it, expect } from 'vitest'
import { EXTRA_MODULES, LICENSE_FEATURES, PLAN_LIMITS, expiresAfterDays, type LicenseFeature, type LicensePlan } from '../src/core/license.ts'
import {
  finalFeatures, finalModules, splitModules, totalBranches, totalUsers, toCount, parseGlobalDefaults, defaultRenewDays, DERIVED_FEATURES,
} from '../src/core/issueForm.ts'
import {
  ACTIVITY_CATALOG, ACTIVITY_MODULES, modulesIncludedInActivity, normalizeActivityId, buildActivityOptions, activityFromDevRecord,
  resolveClientActivity, activityLabel, activityDisplay,
} from '../src/core/activities.ts'
import {
  collectSentNotices, editNoticeInList, removeNoticeFromList, parseNoticeReads, noticeRecipients, summarizeRecipients,
  appendNotice, buildNotice, resolveTargetDevices, type SentNotice,
} from '../src/core/notices.ts'
import { buildCustomerViews, computeStatus, mergeDevRecord, filterCustomers, type CustomerView } from '../src/core/customers.ts'

const PLANS: LicensePlan[] = ['trial', 'basic', 'pro', 'lifetime']
const powerSet = <T,>(arr: readonly T[]): T[][] => arr.reduce<T[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]])

describe('نموذج الإصدار — كل التركيبات', () => {
  it('finalFeatures: تعدد الفروع يتبع الحد الكلي فقط (4 باقات × 0..5 فروع × 64 مجموعة ميزات)', () => {
    let cases = 0
    for (const plan of PLANS) {
      for (let extra = 0; extra <= 5; extra++) {
        for (const selected of powerSet(LICENSE_FEATURES)) {
          const out = finalFeatures(selected, plan, extra)
          const total = PLAN_LIMITS[plan].maxBranches + extra
          expect(out.includes('multi_branch')).toBe(total > 1)
          // الميزات المختارة الأخرى تبقى كلها، بلا تكرار
          for (const f of selected) if (!DERIVED_FEATURES.includes(f)) expect(out).toContain(f)
          expect(new Set(out).size).toBe(out.length)
          cases++
        }
      }
    }
    expect(cases).toBe(4 * 6 * 64)
  })

  it('finalFeatures: الأساسية بلا فروع إضافية تُزيل «تعدد الفروع» حتى لو اختير يدوياً', () => {
    expect(finalFeatures(['multi_branch'], 'basic', 0)).toEqual([])
    expect(finalFeatures(['multi_branch'], 'basic', 1)).toEqual(['multi_branch'])
    expect(finalFeatures([], 'pro', 0)).toEqual(['multi_branch'])
  })

  it('finalFeatures يحفظ ميزات مستقبلية لا تعرفها اللوحة', () => {
    expect(finalFeatures(['future_x' as LicenseFeature], 'basic', 0)).toEqual(['future_x'])
  })

  it('totalBranches/totalUsers: الأعداد السالبة لا تُنقص حد الباقة', () => {
    for (const plan of PLANS) {
      expect(totalBranches(plan, -5)).toBe(PLAN_LIMITS[plan].maxBranches)
      expect(totalUsers(plan, -5)).toBe(PLAN_LIMITS[plan].maxUsers)
      expect(totalBranches(plan, 3)).toBe(PLAN_LIMITS[plan].maxBranches + 3)
    }
  })

  it('toCount: يقبل الأعداد الموجبة فقط ويقرّب لأسفل', () => {
    const table: [unknown, number][] = [
      ['', 0], ['  ', 0], ['0', 0], ['-3', 0], ['abc', 0], ['2.9', 2], [' 7 ', 7], [3, 3], [NaN, 0], [Infinity, 0], [null, 0], [undefined, 0], ['1e2', 100],
    ]
    for (const [input, out] of table) expect(toCount(input as string), String(input)).toBe(out)
  })

  it('finalModules: بلا تكرار، القياسية بترتيبها، والمجهولة تُحفظ في النهاية', () => {
    expect(finalModules(['lab', 'pos', 'zzz', 'pos', 'zzz', 'inventory'])).toEqual(['pos', 'inventory', 'lab', 'zzz'])
    expect(finalModules([])).toEqual([])
  })
})

describe('splitModules — كل نشاط × مجموعات عشوائية', () => {
  let seed = 42
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

  it('الأقسام الثلاث متنافية، واتحادها = كل الأقسام، ولا يُعرض للإضافة قسم مضمّن أو مملوك', () => {
    const activities = [...ACTIVITY_CATALOG.map((a) => a.id), '', 'unknownActivity']
    for (const activityId of activities) {
      for (let i = 0; i < 50; i++) {
        const owned = EXTRA_MODULES.filter(() => rand() < 0.3)
        const { included, owned: o, addable } = splitModules({ activityId, owned })
        const inc = new Set(included)
        expect(o).toEqual(finalModules(owned))
        for (const m of addable) {
          expect(inc.has(m), `${activityId}: ${m} مضمّن ومعروض للإضافة`).toBe(false)
          expect(o.includes(m), `${activityId}: ${m} مملوك ومعروض للإضافة`).toBe(false)
        }
        const union = new Set([...included, ...o, ...addable])
        expect([...union].sort()).toEqual([...EXTRA_MODULES].sort())
        expect(new Set(addable).size).toBe(addable.length)
      }
    }
  })

  it('«نقطة البيع» لا تُعرض للإضافة في أي نشاط يتضمنها', () => {
    for (const [activityId, mods] of Object.entries(ACTIVITY_MODULES)) {
      const { addable } = splitModules({ activityId, owned: [] })
      expect(addable.includes('pos')).toBe(!mods.includes('pos'))
    }
  })

  it('إظهار كل الأقسام: لا شيء مضمّن، وكل غير المملوك قابل للإضافة', () => {
    const { included, addable } = splitModules({ activityId: 'grocery', owned: ['lab'], showAll: true })
    expect(included).toEqual([])
    expect(addable).toEqual(EXTRA_MODULES.filter((m) => m !== 'lab'))
  })

  it('كل أقسام الأنشطة معروفة (لا خطأ إملائي يجعل قسماً «مضمّناً» لا وجود له)', () => {
    for (const [id, mods] of Object.entries(ACTIVITY_MODULES)) {
      for (const m of mods) expect(EXTRA_MODULES, `${id} → ${m}`).toContain(m)
    }
    expect(Object.keys(ACTIVITY_MODULES).sort()).toEqual(ACTIVITY_CATALOG.map((a) => a.id).sort())
    expect(modulesIncludedInActivity('toString')).toEqual([])
    expect(modulesIncludedInActivity('__proto__')).toEqual([])
  })
})

describe('defaultRenewDays / parseGlobalDefaults', () => {
  it('الأيام المتبقية تعيد نفس تاريخ الانتهاء بالضبط (عبر سنوات كبيسة ونهايات الشهور)', () => {
    const todays = ['2026-10-09', '2028-02-28', '2028-02-29', '2026-12-31', '2027-01-31']
    for (const t of todays) {
      for (const d of [1, 2, 27, 28, 29, 30, 31, 59, 365, 366, 1000]) {
        const expiry = expiresAfterDays(d, t)!
        expect(defaultRenewDays(expiry, t)).toBe(d)
        expect(expiresAfterDays(defaultRenewDays(expiry, t), t)).toBe(expiry)
      }
    }
  })

  it('منتهٍ أو ينتهي اليوم أو بلا تاريخ → مدة الافتراضيات', () => {
    expect(defaultRenewDays('2026-10-09', '2026-10-09', 90)).toBe(90)
    expect(defaultRenewDays('2020-01-01', '2026-10-09', 90)).toBe(90)
    expect(defaultRenewDays(null, '2026-10-09', 90)).toBe(90)
  })

  it('تاريخ انتهاء بصيغة ISO كاملة (بوقت) يُفهم ولا يسقط للافتراضي', () => {
    expect(defaultRenewDays('2026-10-19T00:00:00.000Z', '2026-10-09', 365)).toBe(10)
    expect(defaultRenewDays('garbage', '2026-10-09', 365)).toBe(365)
  })

  it('parseGlobalDefaults لا ينهار مع أي مدخل ويعيد دائماً قيماً صالحة', () => {
    const inputs = [null, '', 'null', '[]', '42', '"str"', '{', '{"plan":"gold","days":-4,"features":"x","extraModules":{}}',
      '{"plan":"lifetime","days":"30","extraUsers":"2","extraBranches":2.7}', '{"__proto__":{"plan":"pro"}}']
    for (const raw of inputs) {
      const d = parseGlobalDefaults(raw)
      expect(PLANS, String(raw)).toContain(d.plan)
      expect(d.days).toBeGreaterThan(0)
      expect(Array.isArray(d.features)).toBe(true)
      expect(Array.isArray(d.extraModules)).toBe(true)
      expect(Number.isInteger(d.extraUsers) && d.extraUsers >= 0).toBe(true)
    }
    expect(parseGlobalDefaults('{"plan":"lifetime","days":"30","extraUsers":"2","extraBranches":2.7}')).toMatchObject({ plan: 'lifetime', days: 30, extraUsers: 2, extraBranches: 2 })
  })

  it('parseGlobalDefaults يستبعد قيم الميزات غير النصية', () => {
    expect(parseGlobalDefaults('{"features":["cloud_sync",5,null,{"a":1}]}').features).toEqual(['cloud_sync'])
  })
})

describe('الأنشطة — حالات حدّية', () => {
  it('normalizeActivityId: حرفي تماماً — لا تحويل حالة ولا يونيكود', () => {
    for (const id of ['grocery', 'carParts', 'CARS', 'محل_عطور', 'a', 'x'.repeat(64), 'a.b', 'a-b_c']) expect(normalizeActivityId(id)).toBe(id)
    for (const bad of ['', ' ', 'a b', 'a\tb', 'a\nb', 'a"b', "a'b", 'a\\b', 'x'.repeat(65), null, undefined, 5, {}, []]) {
      expect(normalizeActivityId(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('activityFromDevRecord: أول حقل صالح بالترتيب، ويتجاوز القيم التالفة', () => {
    expect(activityFromDevRecord({ activity: 'pharmacy', activityId: 'grocery' })).toBe('grocery')
    expect(activityFromDevRecord({ activityId: '  ', activity: 7, businessType: 'clinic' })).toBe('clinic')
    expect(activityFromDevRecord({})).toBeNull()
    expect(activityFromDevRecord(null)).toBeNull()
  })

  it('resolveClientActivity: العميل ثم المفتاح ثم لا شيء', () => {
    expect(resolveClientActivity({ clientActivityId: 'a', activityId: 'b' })).toEqual({ id: 'a', source: 'client' })
    expect(resolveClientActivity({ clientActivityId: 'bad id', activityId: 'b' })).toEqual({ id: 'b', source: 'license' })
    expect(resolveClientActivity({})).toEqual({ id: '', source: 'none' })
  })

  it('buildActivityOptions: بلا تكرار حتى مع آلاف العملاء، والمجهول يُضاف مرة واحدة', () => {
    const customers = Array.from({ length: 3000 }, (_, i) => ({ activityId: i % 3 ? 'grocery' : 'bookstore', clientActivityId: i % 5 ? null : 'Bookstore' }))
    const opts = buildActivityOptions(customers, ['bookstore', 'newOne', '', null])
    const values = opts.map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
    expect(values.filter((v) => v === 'bookstore')).toHaveLength(1)
    // حالة الأحرف مهمة: Bookstore ≠ bookstore (معرّفان مختلفان عند التطبيق)
    expect(values).toContain('Bookstore')
    expect(values.at(-1)).toBe('newOne')
    expect(opts.find((o) => o.value === 'newOne')!.label).toBe('newOne')
  })

  it('activityLabel / activityDisplay', () => {
    expect(activityLabel('pharmacy')).toBe('صيدلية')
    expect(activityLabel('')).toBe('أي نشاط')
    expect(activityLabel('zz')).toBe('zz')
    expect(activityDisplay('pharmacy')).toBe('صيدلية (pharmacy)')
    expect(activityDisplay(null)).toBe('—')
  })
})

describe('الإشعارات — حالات حدّية', () => {
  const n = (id: string, createdAt?: string) => ({ id, title: 't', body: 'b', ...(createdAt ? { createdAt } : {}), expiresAt: '2099-01-01T00:00:00Z' })

  it('collectSentNotices لا ينهار مع إشعار بلا createdAt (صيغة قديمة) ويضعه في النهاية', () => {
    const out = collectSentNotices([['notices:global', JSON.stringify([n('old'), n('new', '2026-10-09T00:00:00Z')])]])
    expect(out.map((x) => x.notice.id)).toEqual(['new', 'old'])
  })

  it('collectSentNotices: نفس الإشعار في العام وقائمة جهاز → عام، ويتجاهل المفاتيح الأخرى والقوائم التالفة', () => {
    const out = collectSentNotices([
      ['notices:SHOP-A', JSON.stringify([n('x', '2026-01-01')])],
      ['notices:global', JSON.stringify([n('x', '2026-01-01')])],
      ['notices:SHOP-B', '{broken'],
      ['settings:global', JSON.stringify([n('y', '2026-01-01')])],
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ scope: 'global', deviceIds: ['SHOP-A'] })
    expect(out[0].listKeys.sort()).toEqual(['notices:SHOP-A', 'notices:global'])
  })

  it('editNoticeInList / removeNoticeFromList: إشعار غير موجود → changed=false والقائمة كما هي', () => {
    const raw = JSON.stringify([n('a', '2026-01-01'), { weird: true }])
    expect(editNoticeInList(raw, 'zz', { body: 'x' })).toEqual({ raw, changed: false })
    expect(removeNoticeFromList(raw, 'zz')).toEqual({ raw, changed: false })
    expect(removeNoticeFromList(null, 'a')).toEqual({ raw: '[]', changed: false })
  })

  it('editNoticeInList: تعديل جزئي يترك الحقول الأخرى، وexpiresAt=null مسموح صراحة', () => {
    const raw = JSON.stringify([{ ...n('a', '2026-01-01'), extra: 'يبقى' }])
    const { raw: out, changed } = editNoticeInList(raw, 'a', { expiresAt: null }, new Date('2026-10-09T00:00:00Z'))
    expect(changed).toBe(true)
    expect(JSON.parse(out)[0]).toEqual({ ...n('a', '2026-01-01'), extra: 'يبقى', expiresAt: null, editedAt: '2026-10-09T00:00:00.000Z' })
  })

  it('parseNoticeReads: كل الصيغ المقبولة، ولا تلوّث للنموذج الأولي (__proto__)', () => {
    expect(parseNoticeReads('{"a":"2026","b":5}')).toEqual({ a: '2026', b: '' })
    expect(parseNoticeReads('["a","b"]')).toEqual({ a: '', b: '' })
    expect(parseNoticeReads('[{"id":"a","at":"t"},{"id":5},null]')).toEqual({ a: 't' })
    expect(parseNoticeReads('broken')).toEqual({})
    const polluted = parseNoticeReads('{"__proto__":"x","constructor":"y"}')
    expect(Object.getPrototypeOf({})).not.toHaveProperty('x')
    expect(typeof ({} as Record<string, unknown>).constructor).toBe('function')
    expect(Object.keys(polluted).sort()).toEqual(['__proto__', 'constructor'].sort())
  })

  it('noticeRecipients: إشعار بمعرّف «constructor» لا يُعدّ مقروءاً بالخطأ', () => {
    const sent: SentNotice = { notice: { id: 'constructor', title: '', body: 'b', createdAt: '2026-10-01T00:00:00Z', expiresAt: null }, scope: 'devices', deviceIds: ['A'], listKeys: [] }
    const r = noticeRecipients(sent, [{ deviceId: 'A', customer: 'x', lastSeenAt: null }], new Map([['A', {}]]))
    expect(r[0].state).toBe('pending')
  })

  it('noticeRecipients: قرأه > وصله > لم يصله، والعام يشمل كل العملاء', () => {
    const sent: SentNotice = { notice: { id: 'n', title: '', body: 'b', createdAt: '2026-10-05T00:00:00Z', expiresAt: null }, scope: 'global', deviceIds: [], listKeys: [] }
    const customers = [
      { deviceId: 'A', customer: 'أ', lastSeenAt: '2026-10-06T00:00:00Z' },
      { deviceId: 'B', customer: 'ب', lastSeenAt: '2026-10-06T00:00:00Z' },
      { deviceId: 'C', customer: 'ج', lastSeenAt: '2026-10-01T00:00:00Z' },
      { deviceId: 'D', customer: 'د', lastSeenAt: null },
    ]
    const r = noticeRecipients(sent, customers, new Map([['A', { n: '2026-10-07T00:00:00Z' }]]))
    expect(r.map((x) => x.state)).toEqual(['read', 'delivered', 'pending', 'pending'])
    expect(summarizeRecipients(r)).toEqual({ read: 1, delivered: 1, pending: 2, total: 4 })
  })

  it('appendNotice: يحذف المنتهي ويحتفظ بآخر 50 فقط', () => {
    const now = new Date('2026-10-09T00:00:00Z')
    let raw: string | null = JSON.stringify([{ ...n('expired', '2026-01-01'), expiresAt: '2026-01-02T00:00:00Z' }])
    for (let i = 0; i < 60; i++) raw = appendNotice(raw, { ...buildNotice({ body: `n${i}` }, now), id: `id${i}` }, now)
    const list = JSON.parse(raw!) as { id: string }[]
    expect(list).toHaveLength(50)
    expect(list[0].id).toBe('id10')
    expect(list.some((x) => x.id === 'expired')).toBe(false)
  })

  it('resolveTargetDevices: النشاط يطابق حرفياً (حالة الأحرف)', () => {
    const customers = [{ deviceId: 'A', activityId: 'Cars', clientActivityId: null }, { deviceId: 'B', activityId: 'cars', clientActivityId: null }] as unknown as CustomerView[]
    expect(resolveTargetDevices({ type: 'activity', activityId: 'cars' }, customers)).toEqual({ mode: 'devices', deviceIds: ['B'] })
  })
})

describe('العملاء — حالات حدّية', () => {
  it('computeStatus عند حدود نافذة «قرب الانتهاء» بالضبط', () => {
    const t = '2026-10-09'
    expect(computeStatus({ plan: 'basic', expiresAt: '2026-10-08', todayIso: t })).toBe('expired')
    expect(computeStatus({ plan: 'basic', expiresAt: '2026-10-09', todayIso: t })).toBe('expiring')
    expect(computeStatus({ plan: 'basic', expiresAt: '2026-10-16', todayIso: t })).toBe('expiring')
    expect(computeStatus({ plan: 'basic', expiresAt: '2026-10-17', todayIso: t })).toBe('active')
    expect(computeStatus({ plan: 'lifetime', expiresAt: null, todayIso: t })).toBe('active')
    expect(computeStatus({ plan: '', expiresAt: null, todayIso: t })).toBe('none')
    expect(computeStatus({ plan: 'basic', expiresAt: '2030-01-01', revokedFingerprint: true, todayIso: t })).toBe('revoked')
  })

  it('mergeDevRecord: سجل تالف أو مصفوفة لا يكسر الدمج', () => {
    for (const raw of [null, '', '{bad', '[]', '"str"', '5']) {
      const out = JSON.parse(mergeDevRecord(raw, { plan: 'basic', expiresAt: null, customer: 'x', fingerprint: 'abcd1234' }))
      expect(out).toMatchObject({ plan: 'basic', customer: 'x', fingerprint: 'abcd1234', message: '' })
    }
  })

  it('buildCustomerViews: المفتاح الموقّع هو الحقيقة لو اختلف عن dev:، والحرق من سجل المفتاح يكفي', () => {
    const payload = { v: 1, deviceId: 'A', customer: 'من المفتاح', plan: 'pro', features: ['multi_branch'], issuedAt: '2026-01-01', expiresAt: '2030-01-01', extraModules: ['lab'] }
    const views = buildCustomerViews({
      devEntries: [['A', JSON.stringify({ plan: 'basic', customer: 'قديم', fingerprint: 'ffff0000', expiresAt: '2020-01-01' })]],
      licEntries: [['ffff0000', JSON.stringify({ payload, key: 'SHOPSYS1.x.y', issuedAt: '2026-01-01', revoked: true })]],
      logEntries: [], emailEntries: [], chatEntries: [], revoked: [], todayIso: '2026-10-09',
    })
    expect(views[0]).toMatchObject({ plan: 'pro', customer: 'من المفتاح', expiresAt: '2030-01-01', extraModules: ['lab'], status: 'revoked', licenseKey: 'SHOPSYS1.x.y' })
  })

  it('filterCustomers: البحث بالاسم العربي للنشاط وبالمعرّف', () => {
    const views = buildCustomerViews({
      devEntries: [['A', JSON.stringify({ customer: 'س', activityId: 'pharmacy' })], ['B', JSON.stringify({ customer: 'ص' })]],
      licEntries: [], logEntries: [], emailEntries: [], chatEntries: [], revoked: [], todayIso: '2026-10-09',
    })
    expect(filterCustomers(views, 'صيدلية').map((c) => c.deviceId)).toEqual(['A'])
    expect(filterCustomers(views, 'PHARM').map((c) => c.deviceId)).toEqual(['A'])
    expect(filterCustomers(views, '', 'none')).toHaveLength(2)
  })
})
