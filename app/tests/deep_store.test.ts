/**
 * الفحص السادس — data.store والمنطق الأساسي:
 *  • سجل الترخيص الحالي لا يضيع مهما كثرت سجلات lic: القديمة (كان السرد يُقصّ عند 2000)
 *  • محادثات أجهزة بلا dev: تظهر، وعلامة «جديد» لكل التذاكر
 *  • سجلات تالفة لا تُسقط الواجهة، والترتيب منطقي، والرد لا يحذف رسائل العميل
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { FakeBridge } from './helpers/fakeBridge.ts'

const h = vi.hoisted(() => ({ fake: null as unknown as FakeBridge }))
vi.mock('../src/data/bridge.ts', async () => {
  const { createFakeBridge } = await import('./helpers/fakeBridge.ts')
  h.fake = createFakeBridge()
  return { bridge: h.fake.bridge, isDesktop: () => true, requireDesktop: () => {} }
})

const { useDataStore, MAX_KEYS_PER_PREFIX, READ_CONCURRENCY } = await import('../src/stores/data.store.ts')
const { parseDevRecord, parseLicRecord, buildCustomerViews, filterCustomers, sortCustomers, parseChatSummary } = await import('../src/core/customers.ts')
const { appendChatMessage, parseChat } = await import('../src/core/support.ts')
const { generateOtpCode, buildOtpMessage } = await import('../src/core/otp.ts')

const payload = (deviceId: string, over: Record<string, unknown> = {}) =>
  ({ v: 1, deviceId, customer: 'عميل', plan: 'pro', features: ['reports'], issuedAt: '2026-01-01', expiresAt: '2099-01-01', ...over })

beforeEach(() => {
  h.fake.reset()
  useDataStore.setState({ customers: [], chatOnly: [], warning: null, loading: false, error: null, servicesAvailable: true, servicesError: null })
})

describe('data.store — سجلات lic: القديمة لا تُسقط السجل الحالي', () => {
  it('2500 سجل قديم + جهاز بصمته الحالية الأخيرة ترتيباً ⇒ ميزاته وأقسامه حاضرة', async () => {
    const DEV = 'SHOP-LAST-0000-ZZZZ'
    for (let i = 0; i < 2500; i++) {
      const fp = i.toString(16).padStart(8, '0')
      h.fake.seed('license', `lic:${fp}`, { payload: payload(DEV, { features: [] }), key: `SHOPSYS1.old.${fp}`, issuedAt: '2025-01-01' })
    }
    h.fake.seed('license', `dev:${DEV}`, { customer: 'سوبر ماركت', fingerprint: 'ffffffff', plan: 'pro', expiresAt: '2099-01-01' })
    h.fake.seed('license', 'lic:ffffffff', { payload: payload(DEV, { features: ['reports', 'multi_branch'], extraModules: ['cars'], extraBranches: 2 }), key: 'SHOPSYS1.current.ffffffff', issuedAt: '2026-10-01' })
    const listSpy = vi.spyOn(h.fake.bridge.cf, 'listKeys')

    await useDataStore.getState().refresh()
    const s = useDataStore.getState()
    expect(s.error).toBeNull()
    const c = s.customers.find((x) => x.deviceId === DEV)!
    expect(c).toMatchObject({ licenseKey: 'SHOPSYS1.current.ffffffff', extraModules: ['cars'], extraBranches: 2 })
    expect(c.features).toEqual(['reports', 'multi_branch'])
    // لا سرد لـ lic: إطلاقاً، ولا قراءة لسجلات لا يشير إليها أي جهاز
    expect(listSpy.mock.calls.map((a) => a[1])).not.toContain('lic:')
    expect(h.fake.stats.gets).toBeLessThan(20)
    listSpy.mockRestore()
  })

  it('سجلات نشاط لأجهزة غير معروفة لا تُقرأ، والتزامن ضمن الحد', async () => {
    for (let i = 0; i < 50; i++) {
      const id = `SHOP-${String(i).padStart(4, '0')}-AAAA-BBBB`
      const fp = i.toString(16).padStart(8, '0')
      h.fake.seed('license', `dev:${id}`, { customer: `ع${i}`, fingerprint: fp, plan: 'basic' })
      h.fake.seed('license', `lic:${fp}`, { payload: payload(id), key: `SHOPSYS1.x.${fp}`, issuedAt: '2026-01-01' })
      h.fake.seed('license', `log:${id}`, [{ at: '2026-10-01 10:00', text: 'x' }])
      h.fake.seed('license', `log:GHOST-${i}`, [{ at: '2026-10-01 10:00', text: 'x' }])
    }
    h.fake.latencyMs = 1
    await useDataStore.getState().refresh()
    const s = useDataStore.getState()
    expect(s.customers).toHaveLength(50)
    expect(s.customers.every((c) => c.lastActivityAt === '2026-10-01 10:00' && c.licenseKey)).toBe(true)
    expect(h.fake.stats.gets).toBe(1 + 50 + 50 + 50) // revoked + dev + lic + log المعروف فقط
    expect(h.fake.stats.maxInFlight).toBeLessThanOrEqual(READ_CONCURRENCY + 6)
  })

  it(`أكثر من ${MAX_KEYS_PER_PREFIX} جهاز ⇒ تنبيه صريح بدل القصّ الصامت`, async () => {
    for (let i = 0; i <= MAX_KEYS_PER_PREFIX; i++) h.fake.seed('license', `dev:D${String(i).padStart(5, '0')}`, '{}')
    await useDataStore.getState().refresh()
    const s = useDataStore.getState()
    expect(s.customers).toHaveLength(MAX_KEYS_PER_PREFIX)
    expect(s.warning).toMatch(/الأجهزة \(dev:\)/)
  }, 30_000)

  it('بلا تجاوز ⇒ لا تنبيه', async () => {
    h.fake.seed('license', 'dev:A', JSON.stringify({ plan: 'basic' }))
    await useDataStore.getState().refresh()
    expect(useDataStore.getState().warning).toBeNull()
  })
})

describe('data.store — الدعم', () => {
  it('محادثة جهاز بلا dev: تظهر في chatOnly، و«جديد» من آخر رسالة لكل العملاء (لا أول 60 فقط)', async () => {
    for (let i = 0; i < 80; i++) h.fake.seed('license', `dev:C${String(i).padStart(3, '0')}`, JSON.stringify({ customer: `ع${i}`, plan: 'basic' }))
    h.fake.seed('services', 'chat:C079', [{ id: 1, from: 'client', text: 'مشكلة', at: '2026-10-08T10:00:00Z' }])
    h.fake.seed('services', 'chat:C001', [{ id: 1, from: 'client', text: 'س', at: '2026-10-07T10:00:00Z' }, { id: 2, from: 'developer', text: 'ج', at: '2026-10-07T11:00:00Z' }])
    h.fake.seed('services', 'chat:NEW-DEVICE', [{ id: 1, from: 'client', text: 'لا أستطيع التفعيل', at: '2026-10-09T09:00:00Z' }])
    await useDataStore.getState().refresh()
    const s = useDataStore.getState()
    expect(s.customers.find((c) => c.deviceId === 'C079')).toMatchObject({ supportUnread: true, lastSupportAt: '2026-10-08T10:00:00Z' })
    expect(s.customers.find((c) => c.deviceId === 'C001')).toMatchObject({ supportUnread: false, lastSupportAt: '2026-10-07T11:00:00Z' })
    expect(s.chatOnly).toEqual([{ deviceId: 'NEW-DEVICE', lastSupportAt: '2026-10-09T09:00:00Z', supportUnread: true }])
  })

  it('غياب مساحة الخدمات لا يُسقط العملاء', async () => {
    h.fake.seed('license', 'dev:A', JSON.stringify({ plan: 'basic' }))
    h.fake.missingNs.add('services')
    await useDataStore.getState().refresh()
    const s = useDataStore.getState()
    expect(s.customers).toHaveLength(1)
    expect(s.servicesAvailable).toBe(false)
    expect(s.chatOnly).toEqual([])
  })
})

describe('customers — سجلات تالفة لا تُسقط الواجهة', () => {
  it('dev: مصفوفة أو بحقول بنوع خاطئ', () => {
    expect(parseDevRecord('[1,2]')).toEqual({})
    expect(parseDevRecord(JSON.stringify({ customer: 5, fingerprint: { x: 1 }, plan: 'pro', expiresAt: 7 }))).toEqual({ plan: 'pro' })
  })

  it('lic: بحمولة تالفة تُنقّى (features نص، إضافات نصية، customer رقم) أو تُرفض', () => {
    const rec = parseLicRecord(JSON.stringify({ key: 'K', issuedAt: 1, payload: { plan: 'pro', customer: 42, features: 'reports', extraModules: 'cars', extraUsers: '3', extraBranches: -1, expiresAt: 5 } }))!
    expect(rec.payload).toMatchObject({ customer: '', features: [], extraModules: [], expiresAt: null })
    expect(rec.payload.extraUsers).toBeUndefined()
    expect(rec.payload.extraBranches).toBeUndefined()
    expect(rec.issuedAt).toBe('')
    expect(parseLicRecord(JSON.stringify({ key: 'K', payload: { features: [] } }))).toBeNull() // بلا خطة
    expect(parseLicRecord(JSON.stringify({ key: 7, payload: payload('x') }))).toBeNull()
    expect(parseLicRecord('[]')).toBeNull()
  })

  it('العرض والبحث يعملان فوق سجل تالف', () => {
    const views = buildCustomerViews({
      devEntries: [['D1', JSON.stringify({ fingerprint: 'aaaa0000', customer: 9 })]],
      licEntries: [['aaaa0000', JSON.stringify({ key: 'K', payload: { plan: 'pro', customer: null, features: 'x' } })]],
      logEntries: [], emailEntries: [], chatEntries: [['D1', '{"not":"array"}']], revoked: [], todayIso: '2026-10-09',
    })
    expect(views[0]).toMatchObject({ customer: '', features: [], supportUnread: false, lastSupportAt: null, status: 'active' })
    expect(() => filterCustomers(views, 'abc')).not.toThrow()
  })

  it('ملخص المحادثة يتخطى العناصر الغريبة', () => {
    expect(parseChatSummary(JSON.stringify([null, 5, { from: 'client', at: 1 }, { from: 'x' }]))).toEqual({ count: 1, lastAt: null, unread: true })
    expect(parseChatSummary('oops')).toEqual({ count: 0, lastAt: null, unread: false })
  })
})

describe('customers — الترتيب', () => {
  const base = { email: null, plan: 'pro', activityId: null, clientActivityId: null, features: [], extraUsers: 0, extraBranches: 0, extraModules: [], fingerprint: null, licenseKey: null, licenseIssuedAt: null, lastSeenAt: null, lastSupportAt: null, supportUnread: false, message: '' }
  const c = (deviceId: string, customer: string, status: 'active' | 'expiring' | 'expired' | 'revoked' | 'none', expiresAt: string | null, lastActivityAt: string | null) =>
    ({ ...base, deviceId, customer, status, expiresAt, lastActivityAt })
  const list = [
    c('1', 'أ', 'active', null, '2026-10-01 10:00'),
    c('2', 'ب', 'expired', '2026-01-01', null),
    c('3', 'ج', 'expiring', '2026-10-12', '2026-10-08 09:00'),
    c('4', 'د', 'none', '2027-01-01', '2026-09-01 08:00'),
    c('5', 'هـ', 'revoked', '2026-12-01', null),
  ]
  const ids = (l: { deviceId: string }[]) => l.map((x) => x.deviceId).join('')

  it('الحالة بالأهمية (قرب الانتهاء أولاً) وليس أبجدياً بالإنجليزية', () => {
    expect(ids(sortCustomers(list, 'status'))).toBe('32514')
  })
  it('الانتهاء: الدائم في الآخر تصاعدياً وفي الأول تنازلياً', () => {
    expect(ids(sortCustomers(list, 'expiresAt'))).toBe('23541')
    expect(ids(sortCustomers(list, 'expiresAt', 'desc'))).toBe('14532')
  })
  it('آخر حدث تنازلياً، والبلا نشاط في الآخر في الاتجاهين', () => {
    expect(ids(sortCustomers(list, 'lastActivityAt', 'desc'))).toBe('31425')
    expect(ids(sortCustomers(list, 'lastActivityAt', 'asc'))).toBe('41325')
  })
})

describe('support — الرد لا يحذف رسائل العميل', () => {
  it('يُبقي العناصر بشكل غير معروف ويحسب المعرّف من الأرقام فقط', () => {
    const raw = JSON.stringify([
      { id: 1, from: 'client', text: 'أ', at: 'x' },
      { id: 'v2-uuid', from: 'client', text: 'من إصدار أحدث', at: 'y', attachments: ['img'] },
      { id: 7, from: 'client', text: 'ب', at: 'z' },
    ])
    const next = JSON.parse(appendChatMessage(raw, 'developer', 'رد', '2026-10-09T00:00:00Z'))
    expect(next).toHaveLength(4)
    expect(next[1]).toEqual({ id: 'v2-uuid', from: 'client', text: 'من إصدار أحدث', at: 'y', attachments: ['img'] })
    expect(next[3]).toEqual({ id: 8, from: 'developer', text: 'رد', at: '2026-10-09T00:00:00Z' })
  })

  it('محادثة بصيغة غير مصفوفة ⇒ خطأ بدل الكتابة فوقها', () => {
    expect(() => appendChatMessage('{"broken":true}', 'developer', 'رد')).toThrow(/غير متوقعة/)
    expect(() => appendChatMessage('not json', 'developer', 'رد')).toThrow(/غير متوقعة/)
    expect(JSON.parse(appendChatMessage(null, 'developer', 'أول'))[0].id).toBe(1)
  })

  it('parseChat: at بنوع غير نصي يصبح نصاً فارغاً (كان يُسقط صفحة الدعم)', () => {
    expect(parseChat(JSON.stringify([{ id: 1, from: 'client', text: 't', at: 123 }]))[0].at).toBe('')
  })
})

describe('otp (core) — بلا انحياز وبعربية سليمة', () => {
  it('البايتات ≥ 250 تُرفض ويُعاد السحب', () => {
    let call = 0
    const code = generateOtpCode((buf) => { buf.fill(call++ === 0 ? 255 : 253); if (call > 1) { buf[0] = 3; buf.fill(13, 1) } })
    expect(code).toBe('333333')
    expect(call).toBe(2)
  })
  it('رسالة الرمز بلا كلمات إنجليزية', () => {
    const msg = buildOtpMessage('مركز', '123456', 'استعادة كلمة المرور')
    expect(msg).toContain('لا تشاركه مع أي أحد')
    expect(msg).not.toMatch(/anyone/)
  })
})
