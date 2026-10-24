// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { FakeBridge } from './helpers/fakeBridge.ts'

const h = vi.hoisted(() => ({ fake: null as unknown as FakeBridge }))
vi.mock('../src/data/bridge.ts', async () => {
  const { createFakeBridge } = await import('./helpers/fakeBridge.ts')
  h.fake = createFakeBridge()
  return { bridge: h.fake.bridge, isDesktop: () => true, requireDesktop: () => {} }
})

import { parseRegistrationRecord, filterRegistrations, hasLicense, platformLabelAr, pendingLabelAr, whatsappUrl } from '../src/core/registrations.ts'
import { useDataStore, __resetRegistrationsState, POLL_DEFAULT_MS, FOCUS_COOLDOWN_MS } from '../src/stores/data.store.ts'

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

  it('يتسامح مع حقول تالفة ويُنقّي النصوص ويمنع تلوث النموذج الأولي وانتحال الهوية', () => {
    const raw = JSON.stringify({
      deviceId: 'SHOP-XXXX-YYYY-ZZZZ',
      shopName: '  متجر <script>\nسطر مزيف  ',
      phone: '010 123',
      email: 'not-an-email',
      reports: -5,
      pendingChanges: { shopName: 'اسم جديد', phone: '0111111111', constructor: 'bad', empty: '   ' },
      pendingAt: '2026-10-24T11:00:00Z',
    })
    const rec = parseRegistrationRecord(raw, 'SHOP-XXXX-YYYY-ZZZZ')!
    expect(rec.shopName).toBe('متجر script سطر مزيف')
    expect(rec.email).toBe('')
    expect(rec.reports).toBe(1)
    expect(rec.pendingChanges).toEqual({ shopName: 'اسم جديد', phone: '0111111111' })
    expect(rec.registeredAt).toBe('') // لا يختلق تاريخ اليوم للسجلات الفارغة

    // رفض سجل يختلف معرّفه الداخلي عن مفتاح KV
    expect(parseRegistrationRecord(raw, 'SHOP-1111-2222-3333')).toBeNull()
    // حماية Object.prototype في التسميات
    expect(pendingLabelAr('toString')).toBe('toString')
    expect(pendingLabelAr('shopName')).toBe('المنشأة')
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

  it('whatsappUrl يبني رابط https://wa.me متوافقاً مع أمان Electron ويدعم الأرقام العربية', () => {
    expect(whatsappUrl('01012345678')).toBe('https://wa.me/201012345678')
    expect(whatsappUrl('٠١٠١٢٣٤٥٦٧٨')).toBe('https://wa.me/201012345678')
    expect(whatsappUrl('01012345678', 'EG')).toBe('https://wa.me/201012345678')
    expect(whatsappUrl('0501234567', 'SA')).toBe('https://wa.me/966501234567')
    expect(whatsappUrl('+20 101-234-5678')).toBe('https://wa.me/201012345678')
    expect(whatsappUrl('00201012345678')).toBe('https://wa.me/201012345678')
    expect(whatsappUrl('123')).toBeNull()
    expect(whatsappUrl('')).toBeNull()
    expect(whatsappUrl(undefined)).toBeNull()
  })

  it('فلترة بالبحث (شاملة الأرقام العربية)', () => {
    const list = [
      { deviceId: 'SHOP-AAAA-BBBB-CCCC', shopName: 'محل النور', ownerName: 'أحمد', phone: '٠١٠١٩٩٩', email: '', city: 'المنصورة', street: '', activityNameAr: 'سوبر ماركت', registeredAt: '', firstSeenAt: '', lastSeenAt: '', reports: 1 } as any,
      { deviceId: 'SHOP-XXXX-YYYY-ZZZZ', shopName: 'صيدلية الشفاء', ownerName: 'محمد', phone: '0111', email: '', city: 'القاهرة', street: '', activityNameAr: 'صيدلية', registeredAt: '', firstSeenAt: '', lastSeenAt: '', reports: 1 } as any,
    ]
    expect(filterRegistrations(list, 'النور')).toHaveLength(1)
    expect(filterRegistrations(list, '0101999')).toHaveLength(1)
    expect(filterRegistrations(list, '٠١١١')).toHaveLength(1)
    expect(filterRegistrations(list, '')).toHaveLength(2)
    expect(filterRegistrations(list, 'SHOP-AAAA')).toHaveLength(1)
  })
})

describe('registrations — الفحص التفاضلي الخفيف وحماية حصة Cloudflare المجانية', () => {
  beforeEach(() => {
    h.fake.reset()
    __resetRegistrationsState()
    try { localStorage.clear() } catch { /* ignore */ }
    useDataStore.setState({
      customers: [],
      registrations: [],
      pendingRegistrations: [],
      unreadNew: 0,
      lastNewIds: [],
      chatOnly: [],
      warning: null,
      loading: false,
      error: null,
      lastSyncAt: null,
      servicesAvailable: true,
      servicesError: null,
    })
  })

  it('ثوابت الفحص تحافظ على سقف آمن دون 1000 عملية list يومياً حتى مع تشغيل 24 ساعة', () => {
    expect(POLL_DEFAULT_MS).toBeGreaterThanOrEqual(120_000)
    expect(FOCUS_COOLDOWN_MS).toBeGreaterThanOrEqual(60_000)
    const listsPer24h = (24 * 60 * 60 * 1000) / POLL_DEFAULT_MS
    expect(listsPer24h).toBeLessThan(1000)
  })

  it('عند السكون مع 80 عميل: pollRegistrations ينفذ 1 list فقط وصفر GET', async () => {
    for (let i = 0; i < 80; i++) {
      const id = `SHOP-${String(i).padStart(4, '0')}-AAAA-BBBB`
      h.fake.seed('license', `dev:${id}`, { customer: `عميل ${i}`, plan: 'basic', fingerprint: `fp${i}` })
      h.fake.seed('license', `reg:${id}`, { deviceId: id, shopName: `محل ${i}`, lastSeenAt: '2026-10-20T10:00:00Z' })
    }
    await useDataStore.getState().refresh()
    expect(useDataStore.getState().registrations).toHaveLength(80)

    // نصفّر عدّادات الطلبات لقياس تكلفة الفحص الدوري وحده
    h.fake.stats.lists = 0
    h.fake.stats.gets = 0
    h.fake.stats.puts = 0

    await useDataStore.getState().pollRegistrations()
    expect(h.fake.stats.lists).toBe(1)
    expect(h.fake.stats.gets).toBe(0)
    expect(h.fake.stats.puts).toBe(0)
  })

  it('عند تسجيل عميل جديد: يقرأ المفتاح الجديد فقط ويطلق التنبيه مرة واحدة دون تكرار', async () => {
    const EXISTING = 'SHOP-0001-AAAA-BBBB'
    h.fake.seed('license', `reg:${EXISTING}`, { deviceId: EXISTING, shopName: 'محل قديم', lastSeenAt: '2026-10-20T10:00:00Z' })
    await useDataStore.getState().refresh()
    expect(useDataStore.getState().unreadNew).toBe(0)

    const notifySpy = vi.spyOn(h.fake.bridge.app, 'notify')
    const tgSpy = vi.spyOn(h.fake.bridge.tg, 'send')

    h.fake.stats.lists = 0
    h.fake.stats.gets = 0

    // يسجّل عميل جديد الآن
    const NEW_ID = 'SHOP-9999-CCCC-DDDD'
    h.fake.seed('license', `reg:${NEW_ID}`, {
      deviceId: NEW_ID,
      shopName: 'سوبر ماركت الأمل',
      ownerName: 'محمود',
      phone: '01099998888',
      city: 'المنصورة',
      activityNameAr: 'بقالة',
      lastSeenAt: '2026-10-24T12:00:00Z',
    })

    await useDataStore.getState().pollRegistrations()

    // 1 list لبادئة reg: + قراءتان فقط (reg:NEW + dev:NEW) — لم يُعد قراءة القديم!
    expect(h.fake.stats.lists).toBe(1)
    expect(h.fake.stats.gets).toBe(2)

    const st = useDataStore.getState()
    expect(st.registrations).toHaveLength(2)
    expect(st.pendingRegistrations.map((r) => r.deviceId)).toContain(NEW_ID)
    expect(st.unreadNew).toBe(1)
    expect(st.lastNewIds).toEqual([NEW_ID])
    expect(notifySpy).toHaveBeenCalledTimes(1)
    expect(tgSpy).toHaveBeenCalledTimes(1)

    // دورة تالية بلا تغيير: صفر GET ولا تكرار للتنبيه
    h.fake.stats.lists = 0
    h.fake.stats.gets = 0
    await useDataStore.getState().pollRegistrations()
    expect(h.fake.stats.lists).toBe(1)
    expect(h.fake.stats.gets).toBe(0)
    expect(notifySpy).toHaveBeenCalledTimes(1)
    expect(tgSpy).toHaveBeenCalledTimes(1)
    // يبقى البانر والبادج ظاهرين حتى يفتح المستخدم الصفحة
    expect(useDataStore.getState().unreadNew).toBe(1)
    expect(useDataStore.getState().lastNewIds).toEqual([NEW_ID])

    useDataStore.getState().markRegistrationsSeen()
    expect(useDataStore.getState().unreadNew).toBe(0)
    expect(useDataStore.getState().lastNewIds).toEqual([])

    notifySpy.mockRestore()
    tgSpy.mockRestore()
  })

  it('عميل رُخّص عبر البوت لا يُطلق تنبيه معلّق كاذب عند ظهوره في pollRegistrations', async () => {
    await useDataStore.getState().refresh()
    const notifySpy = vi.spyOn(h.fake.bridge.app, 'notify')

    const LICENSED_NEW = 'SHOP-7777-EEEE-FFFF'
    h.fake.seed('license', `reg:${LICENSED_NEW}`, { deviceId: LICENSED_NEW, shopName: 'مرخص مسبقاً', lastSeenAt: '2026-10-24T12:00:00Z' })
    h.fake.seed('license', `dev:${LICENSED_NEW}`, { customer: 'مرخص مسبقاً', plan: 'pro', fingerprint: 'abcd1234' })

    await useDataStore.getState().pollRegistrations()
    expect(useDataStore.getState().registrations).toHaveLength(1)
    expect(useDataStore.getState().pendingRegistrations).toHaveLength(0)
    expect(useDataStore.getState().unreadNew).toBe(0)
    expect(notifySpy).not.toHaveBeenCalled()
    notifySpy.mockRestore()
  })

  it('يكتشف العميل الذي سجّل أثناء إغلاق اللوحة فور إعادة الفتح', async () => {
    const OLD_ID = 'SHOP-1111-2222-3333'
    localStorage.setItem('controler:seenRegIds', JSON.stringify([OLD_ID]))
    h.fake.seed('license', `reg:${OLD_ID}`, { deviceId: OLD_ID, shopName: 'قديم', lastSeenAt: '2026-10-20T10:00:00Z' })

    const OFFLINE_NEW = 'SHOP-4444-5555-6666'
    h.fake.seed('license', `reg:${OFFLINE_NEW}`, { deviceId: OFFLINE_NEW, shopName: 'سجّل ليلاً', lastSeenAt: '2026-10-24T03:00:00Z' })

    const notifySpy = vi.spyOn(h.fake.bridge.app, 'notify')
    await useDataStore.getState().refresh()

    expect(useDataStore.getState().unreadNew).toBe(1)
    expect(useDataStore.getState().lastNewIds).toEqual([OFFLINE_NEW])
    expect(notifySpy).toHaveBeenCalledTimes(1)
    notifySpy.mockRestore()
  })

  it('تهدئة window.focus تمنع حرق الطلبات عند التنقل المتكرر للنافذة', async () => {
    await useDataStore.getState().refresh()
    const stop = useDataStore.getState().startPolling(300_000)
    try {
      h.fake.stats.lists = 0
      h.fake.stats.gets = 0
      for (let i = 0; i < 10; i++) {
        window.dispatchEvent(new Event('focus'))
      }
      await new Promise((r) => setTimeout(r, 20))
      expect(h.fake.stats.lists).toBe(0)
      expect(h.fake.stats.gets).toBe(0)
    } finally {
      stop()
    }
  })

  it('في بيئة Electron يُرسل إشعار نظام واحد عبر bridge.app.notify دون تكرار window.Notification', async () => {
    await useDataStore.getState().refresh()
    const webNotifySpy = vi.fn()
    const origNotification = (window as unknown as { Notification?: unknown }).Notification
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: Object.assign(webNotifySpy, { permission: 'granted', requestPermission: async () => 'granted' }),
    })
    const appNotifySpy = vi.spyOn(h.fake.bridge.app, 'notify')
    try {
      const NEW_ID = 'SHOP-8888-7777-6666'
      h.fake.seed('license', `reg:${NEW_ID}`, { deviceId: NEW_ID, shopName: 'صيدلية السلام', lastSeenAt: '2026-10-24T14:00:00Z' })
      await useDataStore.getState().pollRegistrations()
      expect(appNotifySpy).toHaveBeenCalledTimes(1)
      expect(webNotifySpy).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'Notification', { configurable: true, value: origNotification })
      appNotifySpy.mockRestore()
    }
  })

  it('يدمج المسجلين الجدد (reg: بلا dev:) داخل customers بحالة بدون اشتراك (status=none)', async () => {
    const REG_ONLY = 'SHOP-5555-6666-7777'
    h.fake.seed('license', `reg:${REG_ONLY}`, {
      deviceId: REG_ONLY,
      shopName: 'معرض طيبة',
      email: 'taiba@shop.eg',
      activityId: 'electronics',
      lastSeenAt: '2026-10-24T09:30:00Z',
    })
    await useDataStore.getState().refresh()
    const c = useDataStore.getState().customers.find((x) => x.deviceId === REG_ONLY)!
    expect(c).toBeTruthy()
    expect(c).toMatchObject({
      customer: 'معرض طيبة',
      email: 'taiba@shop.eg',
      clientActivityId: 'electronics',
      status: 'none',
      plan: '',
      lastSeenAt: '2026-10-24T09:30:00Z',
    })
  })

  it('الذرّية في pollRegistrations: فشل قراءة dev: المؤقت لا يلوث knownRegCache ويعاد التنبيه عند تعافي الشبكة', async () => {
    await useDataStore.getState().refresh()
    const notifySpy = vi.spyOn(h.fake.bridge.app, 'notify')
    const NEW_ID = 'SHOP-2222-3333-4444'
    h.fake.seed('license', `reg:${NEW_ID}`, { deviceId: NEW_ID, shopName: 'مخبز البركة', lastSeenAt: '2026-10-24T15:00:00Z' })
    h.fake.failGet.add(`license:dev:${NEW_ID}`)

    // الدورة الأولى تفشل عند قراءة dev: ← لا يجوز تسجيل المفتاح كمقروء في الذاكرة
    await useDataStore.getState().pollRegistrations()
    expect(useDataStore.getState().registrations).toHaveLength(0)
    expect(notifySpy).not.toHaveBeenCalled()

    // تتعافى الشبكة في الدورة التالية ← يُقرأ ويُنبَّه بنجاح
    h.fake.failGet.delete(`license:dev:${NEW_ID}`)
    await useDataStore.getState().pollRegistrations()
    expect(useDataStore.getState().registrations).toHaveLength(1)
    expect(notifySpy).toHaveBeenCalledTimes(1)
    notifySpy.mockRestore()
  })
})
