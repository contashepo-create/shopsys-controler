/**
 * «قراءة فاشلة ≠ مفتاح فارغ» — كل مسار يقرأ ثم يكتب (read-modify-write) فوق KV وهمي يُحقن فيه
 * فشل قراءة (مثل 429 لحظي). قبل الإصلاح كانت هذه المسارات تعامل الفشل كقائمة فارغة ثم تكتب
 * فوق البيانات الحقيقية: تمسح قائمة الحرق، أو سجل الجهاز، أو الإشعارات، أو محادثة الدعم.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { FakeBridge } from './helpers/fakeBridge.ts'

const h = vi.hoisted(() => ({ fake: null as unknown as FakeBridge }))
vi.mock('../src/data/bridge.ts', async () => {
  const { createFakeBridge } = await import('./helpers/fakeBridge.ts')
  h.fake = createFakeBridge()
  return { bridge: h.fake.bridge, isDesktop: () => true, requireDesktop: () => {} }
})

const actions = await import('../src/data/actions.ts')
const customerActions = await import('../src/data/customerActions.ts')
const { decodeLicenseKey } = await import('../src/core/license.ts')
const { buildCustomerViews } = await import('../src/core/customers.ts')
const { useDataStore } = await import('../src/stores/data.store.ts')

const DEV = 'SHOP-AB12-CD34-EF56'
const DEV2 = 'SHOP-ZZ99-YY88-XX77'
const DEV3 = 'SHOP-QQ11-WW22-EE33'
const base = (over: Partial<Parameters<typeof actions.issueLicense>[0]> = {}) =>
  ({ deviceId: DEV, customer: 'بقالة النور', plan: 'basic' as const, days: 30, features: [], ...over })
const fail = (ns: 'license' | 'services', key: string) => h.fake.failGet.add(`${ns}:${key}`)
const snapshot = () => ({ license: new Map(h.fake.kv.license), services: new Map(h.fake.kv.services) })
const viewOf = (deviceId: string) => {
  const kv = h.fake.kv.license
  const pick = (p: string) => [...kv.entries()].filter(([k]) => k.startsWith(p)).map(([k, v]) => [k.slice(p.length), v] as const)
  return buildCustomerViews({
    devEntries: pick('dev:'), licEntries: pick('lic:'), logEntries: [], emailEntries: [], chatEntries: [],
    revoked: h.fake.json<string[]>('license', 'revoked') ?? [], todayIso: new Date().toISOString().slice(0, 10),
  }).find((c) => c.deviceId === deviceId)!
}

beforeEach(() => { h.fake.reset() })

describe('readForUpdate / appendLog', () => {
  it('readForUpdate يرمي عند الفشل ويحمل الرمز؛ مفتاح غير موجود = null', async () => {
    expect(await actions.readForUpdate('license', 'nothing')).toBeNull()
    fail('license', 'x')
    await expect(actions.readForUpdate('license', 'x')).rejects.toThrow(/حد طلبات/)
    h.fake.missingNs.add('services')
    await expect(actions.readForUpdate('services', 'y')).rejects.toMatchObject({ code: 'ns_missing' })
  })

  it('appendLog: قراءة فاشلة → لا كتابة (لا يُمسح السجل القديم) ويعيد false', async () => {
    h.fake.seed('license', `log:${DEV}`, [{ at: '2026-01-01 10:00', text: 'قديم 1' }, { at: '2026-01-02 10:00', text: 'قديم 2' }])
    fail('license', `log:${DEV}`)
    expect(await actions.appendLog(DEV, 'جديد')).toBe(false)
    expect(h.fake.json<unknown[]>('license', `log:${DEV}`)).toHaveLength(2)
    h.fake.failGet.clear()
    expect(await actions.appendLog(DEV, 'جديد')).toBe(true)
    expect(h.fake.json<{ text: string }[]>('license', `log:${DEV}`)!.map((e) => e.text)).toEqual(['قديم 1', 'قديم 2', 'جديد'])
  })
})

describe('issueLicense تحت فشل القراءة', () => {
  it('فشل قراءة dev: → لا توقيع ولا كتابة إطلاقاً (كان يكتب سجلاً ناقصاً يمسح نشاط العميل)', async () => {
    h.fake.seed('license', `dev:${DEV}`, { clientActivityId: 'pharmacy', lastSeenAt: '2026-10-01T00:00:00Z' })
    const before = snapshot()
    fail('license', `dev:${DEV}`)
    await expect(actions.issueLicense(base())).rejects.toThrow()
    expect(h.fake.stats.puts).toBe(0)
    expect(h.fake.kv.license).toEqual(before.license)
    expect(h.fake.audit).toEqual([])
  })

  it('فشل قراءة قائمة الحرق → يتوقف (لا نخاطر بمفتاح مولود محروقاً)', async () => {
    fail('license', 'revoked')
    await expect(actions.issueLicense(base())).rejects.toThrow()
    expect(h.fake.stats.puts).toBe(0)
  })

  it('مساحة الخدمات غير مضبوطة لا تمنع فحص الحرق (تُتجاوز)، ويصدر المفتاح', async () => {
    h.fake.missingNs.add('services')
    const res = await actions.issueLicense(base())
    expect(h.fake.json('license', `lic:${res.fingerprint}`)).toBeTruthy()
  })

  it('فشل قراءة السجل → المفتاح يصدر، السجل القديم سليم، وملاحظة تشرح', async () => {
    h.fake.seed('license', `log:${DEV}`, [{ at: '2026-01-01 10:00', text: 'قديم' }])
    fail('license', `log:${DEV}`)
    const res = await actions.issueLicense(base())
    expect(res.key).toMatch(/^SHOPSYS1\./)
    expect(h.fake.json<{ text: string }[]>('license', `log:${DEV}`)!.map((e) => e.text)).toEqual(['قديم'])
    expect(res.notes.join(' ')).toMatch(/سجل/)
  })

  it('المعاينة = ما يُوقَّع فعلاً (إزالة تكرار الميزات والأقسام)', async () => {
    const input = base({ features: ['reports', 'reports'], extraModules: ['cars', 'cars'] })
    const preview = actions.previewPayload(input)
    expect(preview.features).toEqual(['reports'])
    expect(preview.extraModules).toEqual(['cars'])
    const res = await actions.issueLicense(input)
    const signed = decodeLicenseKey(res.key)!.payload
    expect({ ...signed, issuedAt: '', expiresAt: '' }).toEqual({ ...preview, issuedAt: '', expiresAt: '' })
  })
})

describe('revokeLicense', () => {
  it('فشل قراءة قائمة الحرق → يرمي ولا يمسح القائمة (كان يكتب [fp] فوق كل المحروق)', async () => {
    h.fake.seed('license', 'revoked', ['aaaaaaaa', 'bbbbbbbb'])
    fail('license', 'revoked')
    await expect(actions.revokeLicense('cccccccc')).rejects.toThrow()
    expect(h.fake.json('license', 'revoked')).toEqual(['aaaaaaaa', 'bbbbbbbb'])
  })

  it('فشل قراءة قائمة الخدمات (غير ns_missing) → يرمي ولا يمسحها', async () => {
    h.fake.seed('services', 'revoked', ['aaaaaaaa'])
    fail('services', 'revoked')
    await expect(actions.revokeLicense('cccccccc')).rejects.toThrow()
    expect(h.fake.json('services', 'revoked')).toEqual(['aaaaaaaa'])
  })

  it('مساحة الخدمات غير مضبوطة → يُحرق في التراخيص مع ملاحظة', async () => {
    h.fake.missingNs.add('services')
    const r = await actions.revokeLicense('cccccccc')
    expect(r.fingerprint).toBe('cccccccc')
    expect(h.fake.json('license', 'revoked')).toEqual(['cccccccc'])
    expect(r.notes.join(' ')).toMatch(/مساحة الخدمات/)
  })

  it('ينظّف العناصر غير النصية، ولا يكرر البصمة، وسجل تدقيق واحد', async () => {
    h.fake.seed('license', 'revoked', ['aaaaaaaa', 5, null, { x: 1 }])
    await actions.revokeLicense('aaaaaaaa')
    await actions.revokeLicense('bbbbbbbb')
    expect(h.fake.json('license', 'revoked')).toEqual(['aaaaaaaa', 'bbbbbbbb'])
    expect(h.fake.audit.filter((a) => a.action === 'license_revoke')).toHaveLength(2)
  })

  it('يزيل المفتاح المحروق من sub: فقط إن كان هو نفسه، ويعلّم السجل', async () => {
    const res = await actions.issueLicense(base())
    expect(h.fake.json('services', `sub:${DEV}`)).toMatchObject({ key: res.key })
    const r = await actions.revokeLicense(res.key)
    expect(r.fingerprint).toBe(res.fingerprint)
    const sub = h.fake.json<Record<string, unknown>>('services', `sub:${DEV}`)!
    expect(sub.key).toBeUndefined()
    expect(sub.fingerprint).toBeUndefined()
    expect(sub.plan).toBe('basic')
    expect(h.fake.json('license', `lic:${res.fingerprint}`)).toMatchObject({ revoked: true })
    const audits = h.fake.audit.filter((a) => a.action === 'license_revoke')
    expect(audits).toHaveLength(1)
    expect(audits[0].target).toBe(DEV)
  })

  it('مفتاح قديم لا يطابق sub: الحالي → sub: لا يُمس', async () => {
    const old = await actions.issueLicense(base({ days: 10 }))
    const cur = await actions.issueLicense(base({ days: 20 }))
    await actions.revokeLicense(old.fingerprint)
    expect(h.fake.json('services', `sub:${DEV}`)).toMatchObject({ key: cur.key, fingerprint: cur.fingerprint })
  })

  it('تعذر قراءة سجل lic: → الحرق يتم مع ملاحظة، والتدقيق باسم البصمة', async () => {
    fail('license', 'lic:dddddddd')
    const r = await actions.revokeLicense('dddddddd')
    expect(h.fake.json('license', 'revoked')).toEqual(['dddddddd'])
    expect(r.notes.join(' ')).toMatch(/تعذر قراءة سجله/)
    expect(h.fake.audit.at(-1)).toMatchObject({ action: 'license_revoke', target: 'dddddddd' })
  })
})

describe('sendNotice', () => {
  const customers = () => [DEV, DEV2, DEV3].map((d) => ({ deviceId: d, customer: d, activityId: null, clientActivityId: null })) as never

  it('عام: فشل القراءة → يرمي ولا يمسح الإشعارات العامة', async () => {
    h.fake.seed('license', 'notices:global', [{ id: 'old', title: 't', body: 'قديم', createdAt: '2026-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z' }])
    fail('license', 'notices:global')
    await expect(actions.sendNotice({ body: 'إشعار عام جديد', targeting: { type: 'all' }, customers: customers() })).rejects.toThrow()
    expect(h.fake.json<unknown[]>('license', 'notices:global')).toHaveLength(1)
  })

  it('أجهزة: فشل جهاز واحد لا يوقف الباقين، ويُعاد في failed، وقائمته سليمة', async () => {
    h.fake.seed('license', `notices:${DEV2}`, [{ id: 'old', title: 't', body: 'قديم', createdAt: '2026-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z' }])
    fail('license', `notices:${DEV2}`)
    const r = await actions.sendNotice({ body: 'مرحبا بكم جميعاً', targeting: { type: 'group', deviceIds: [DEV, DEV2, DEV3] }, customers: customers() })
    expect(r).toEqual({ targets: 2, mode: 'devices', failed: [DEV2] })
    expect(h.fake.json<{ body: string }[]>('license', `notices:${DEV}`)!.map((n) => n.body)).toEqual(['مرحبا بكم جميعاً'])
    expect(h.fake.json<{ body: string }[]>('license', `notices:${DEV3}`)!.map((n) => n.body)).toEqual(['مرحبا بكم جميعاً'])
    expect(h.fake.json<{ body: string }[]>('license', `notices:${DEV2}`)!.map((n) => n.body)).toEqual(['قديم'])
    expect(h.fake.audit.at(-1)).toMatchObject({ action: 'notice_send', details: { failed: 1 } })
  })

  it('فشل الكتابة لجهاز يُحسب فشلاً أيضاً؛ فشل الكل → خطأ', async () => {
    h.fake.failPut.add(`license:notices:${DEV}`)
    const r = await actions.sendNotice({ body: 'إشعار تجريبي أول', targeting: { type: 'group', deviceIds: [DEV, DEV2] }, customers: customers() })
    expect(r.failed).toEqual([DEV])
    fail('license', `notices:${DEV2}`)
    await expect(actions.sendNotice({ body: 'إشعار تجريبي ثانٍ', targeting: { type: 'group', deviceIds: [DEV, DEV2] }, customers: customers() })).rejects.toThrow()
  })
})

describe('بقية مسارات القراءة-ثم-الكتابة', () => {
  it('replySupport: فشل قراءة المحادثة → يرمي ولا يمسحها', async () => {
    h.fake.seed('services', `chat:${DEV}`, [{ from: 'client', text: 'مشكلة', at: '2026-10-01T00:00:00Z' }])
    fail('services', `chat:${DEV}`)
    await expect(actions.replySupport(DEV, 'أهلاً')).rejects.toThrow()
    expect(h.fake.json<unknown[]>('services', `chat:${DEV}`)).toHaveLength(1)
  })

  it('setCloudFlag: فشل القراءة → يرمي ولا يُعيد تشغيل ميزات مطفأة؛ قيمة غير كائن تُستبدل بأمان', async () => {
    h.fake.seed('services', `flags:${DEV}`, { disabledFeatures: ['reports', 'multi_branch'], noteAr: 'تأخر سداد' })
    fail('services', `flags:${DEV}`)
    await expect(actions.setCloudFlag(DEV, 'cloud_backup', true)).rejects.toThrow()
    expect(h.fake.json('services', `flags:${DEV}`)).toMatchObject({ disabledFeatures: ['reports', 'multi_branch'] })
    h.fake.failGet.clear()
    h.fake.seed('services', `flags:${DEV2}`, '[1,2]')
    await actions.setCloudFlag(DEV2, 'reports', true)
    expect(h.fake.json('services', `flags:${DEV2}`)).toMatchObject({ disabledFeatures: ['reports'] })
  })

  it('readCloudFlags: فشل القراءة يُرمى (لا «لا شيء مطفأ» كاذب)، وقيم تالفة تُنظَّف', async () => {
    h.fake.seed('services', `flags:${DEV}`, { disabledFeatures: ['reports'], noteAr: 'x' })
    fail('services', `flags:${DEV}`)
    await expect(actions.readCloudFlags(DEV)).rejects.toThrow()
    h.fake.failGet.clear()
    expect(await actions.readCloudFlags(DEV)).toEqual({ disabledFeatures: ['reports'], noteAr: 'x' })
    h.fake.seed('services', `flags:${DEV2}`, { disabledFeatures: ['reports', 7, null], noteAr: 5 })
    expect(await actions.readCloudFlags(DEV2)).toEqual({ disabledFeatures: ['reports'], noteAr: '' })
    expect(await actions.readCloudFlags(DEV3)).toEqual({ disabledFeatures: [], noteAr: '' })
  })

  it('sendKeyToCustomer: فشل قراءة إشعارات الجهاز → يرمي ولا يمسحها', async () => {
    h.fake.seed('license', `notices:${DEV}`, [{ id: 'a', title: 't', body: 'b', createdAt: '2026-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z' }])
    fail('license', `notices:${DEV}`)
    await expect(actions.sendKeyToCustomer({ deviceId: DEV, customer: 'x', key: 'SHOPSYS1.a.b', fingerprint: 'abcdabcd' })).rejects.toThrow()
    expect(h.fake.json<unknown[]>('license', `notices:${DEV}`)).toHaveLength(1)
  })

  it('editNotice / deleteNotice: فشل القراءة → يرمي ولا يمس القائمة', async () => {
    const list = [{ id: 'n1', title: 't', body: 'b', createdAt: '2026-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z' }]
    h.fake.seed('license', 'notices:global', list)
    const sent = { notice: list[0], scope: 'global' as const, deviceIds: [], listKeys: ['notices:global'] }
    fail('license', 'notices:global')
    await expect(actions.editNotice(sent, { body: 'جديد' })).rejects.toThrow()
    await expect(actions.deleteNotice(sent)).rejects.toThrow()
    expect(h.fake.json('license', 'notices:global')).toEqual(list)
  })

  it('lookupDevice: فشل القراءة يرمي (لا «جهاز جديد» يسحب من العميل أقسامه)', async () => {
    await actions.issueLicense(base({ extraModules: ['cars'] }))
    fail('license', `dev:${DEV}`)
    await expect(actions.lookupDevice(DEV)).rejects.toThrow()
    h.fake.failGet.clear()
    fail('license', 'revoked')
    await expect(actions.lookupDevice(DEV)).rejects.toThrow()
    h.fake.failGet.clear()
    expect((await actions.lookupDevice(DEV))!.extraModules).toEqual(['cars'])
    expect(await actions.lookupDevice(DEV2)).toBeNull()
  })

  it('readGlobalDefaults يرمي عند الفشل؛ updateGlobalSettings يحفظ حقول البوت غير المعروفة', async () => {
    h.fake.seed('license', 'settings:global', { plan: 'pro', days: 90, botOnly: 'keep-me', features: [] })
    fail('license', 'settings:global')
    await expect(actions.readGlobalDefaults()).rejects.toThrow()
    await expect(actions.updateGlobalSettings({ plan: 'basic', days: 30, features: [], extraUsers: 0, extraBranches: 0, extraModules: [] })).rejects.toThrow()
    expect(h.fake.json('license', 'settings:global')).toMatchObject({ plan: 'pro', botOnly: 'keep-me' })
    h.fake.failGet.clear()
    await actions.updateGlobalSettings({ plan: 'basic', days: 30, features: [], extraUsers: 0, extraBranches: 0, extraModules: [] })
    expect(h.fake.json('license', 'settings:global')).toMatchObject({ plan: 'basic', days: 30, botOnly: 'keep-me' })
  })
})

describe('deactivateCustomer', () => {
  it('يحرق، يعلّم الجهاز، يضيف للسجل، وسجل تدقيق «تعطيل عميل»', async () => {
    await actions.issueLicense(base())
    const r = await customerActions.deactivateCustomer(viewOf(DEV))
    expect(r.notes).toEqual([])
    expect(viewOf(DEV).status).toBe('revoked')
    expect(h.fake.json('license', `dev:${DEV}`)).toMatchObject({ message: expect.stringContaining('إيقاف') })
    expect(h.fake.json<{ disabledAt?: string }>('license', `dev:${DEV}`)!.disabledAt).toBeTruthy()
    expect(h.fake.json<{ text: string }[]>('license', `log:${DEV}`)!.at(-1)!.text).toMatch(/تعطيل/)
    expect(h.fake.audit.map((a) => a.action)).toEqual(['license_issue', 'license_revoke', 'customer_deactivate'])
  })

  it('فشل قراءة dev: → الحرق تم ولا يُكتب سجل ناقص فوقه، مع ملاحظة', async () => {
    await actions.issueLicense(base())
    const view = viewOf(DEV)
    const devBefore = h.fake.kv.license.get(`dev:${DEV}`)
    fail('license', `dev:${DEV}`)
    const r = await customerActions.deactivateCustomer(view)
    expect(h.fake.json<string[]>('license', 'revoked')).toContain(view.fingerprint)
    expect(h.fake.kv.license.get(`dev:${DEV}`)).toBe(devBefore)
    expect(r.notes.join(' ')).toMatch(/سجل الجهاز/)
  })

  it('بلا بصمة → خطأ واضح بلا أي كتابة', async () => {
    await expect(customerActions.deactivateCustomer({ deviceId: DEV, fingerprint: null } as never)).rejects.toThrow(/بصمة/)
    expect(h.fake.stats.puts).toBe(0)
  })
})

describe('data.store: قراءة فاشلة لا تمسح القائمة، والتحديثات لا تضيع', () => {
  beforeEach(() => { useDataStore.setState({ customers: [], loading: false, error: null, lastSyncAt: null, servicesAvailable: true, servicesError: null }) })

  it('فشل قراءة مفتاح عميل → خطأ وتبقى القائمة السابقة (لا «بدون اشتراك»)', async () => {
    const res = await actions.issueLicense(base({ extraModules: ['cars'] }))
    await useDataStore.getState().refresh()
    expect(useDataStore.getState().customers.find((c) => c.deviceId === DEV)!.extraModules).toEqual(['cars'])
    fail('license', `lic:${res.fingerprint}`)
    await useDataStore.getState().refresh()
    const st = useDataStore.getState()
    expect(st.error).toMatch(/بقيت البيانات السابقة/)
    expect(st.customers.find((c) => c.deviceId === DEV)!.extraModules).toEqual(['cars'])
  })

  it('فشل قراءة قائمة الحرق → خطأ (لا تظهر المفاتيح المحروقة «نشطة»)', async () => {
    const res = await actions.issueLicense(base())
    await actions.revokeLicense(res.fingerprint)
    await useDataStore.getState().refresh()
    expect(useDataStore.getState().customers[0].status).toBe('revoked')
    fail('license', 'revoked')
    await useDataStore.getState().refresh()
    expect(useDataStore.getState().error).toMatch(/قائمة الحرق/)
    expect(useDataStore.getState().customers[0].status).toBe('revoked')
  })

  it('تحديث أثناء تحديث جارٍ يُجدوَل بعده (كان يُتجاهل فيضيع إصدار اللحظة الأخيرة)، ولا يتضاعف', async () => {
    await actions.issueLicense(base())
    h.fake.stats.lists = 0
    await useDataStore.getState().refresh()
    const listsPerRefresh = h.fake.stats.lists
    expect(listsPerRefresh).toBeGreaterThan(0)

    // جهاز ثانٍ جاهز في الذاكرة لنزرعه لاحقاً (نفس ما يكتبه الإصدار)
    const second0 = await actions.issueLicense(base({ deviceId: DEV2, customer: 'صيدلية' }))
    const dev2 = h.fake.kv.license.get(`dev:${DEV2}`)!
    const lic2 = h.fake.kv.license.get(`lic:${second0.fingerprint}`)!
    h.fake.kv.license.delete(`dev:${DEV2}`); h.fake.kv.license.delete(`lic:${second0.fingerprint}`)

    h.fake.stats.lists = 0
    h.fake.latencyMs = 3
    const first = useDataStore.getState().refresh()
    // ننتظر حتى ينتهي التحديث الأول من سرد المفاتيح، ثم «يصدر» مفتاح جديد ويُطلب تحديث
    while (h.fake.stats.lists < listsPerRefresh) await new Promise((r) => setTimeout(r, 1))
    h.fake.kv.license.set(`dev:${DEV2}`, dev2); h.fake.kv.license.set(`lic:${second0.fingerprint}`, lic2)
    const second = useDataStore.getState().refresh()
    const third = useDataStore.getState().refresh()
    expect(second).not.toBe(first)
    expect(third).toBe(second) // طلبات متراكمة تُدمج في تحديث واحد لاحق
    await first
    expect(useDataStore.getState().customers.map((c) => c.deviceId)).toEqual([DEV]) // الأول لم يرَ الجديد
    await Promise.all([second, third])
    expect(h.fake.stats.lists).toBe(listsPerRefresh * 2) // تحديثان بالضبط، لا ثلاثة
    expect(useDataStore.getState().customers.map((c) => c.deviceId).sort()).toEqual([DEV, DEV2].sort())
    expect(useDataStore.getState().loading).toBe(false)
  })
})

describe('سلامة: لم يبقَ مسار يتجاهل فشل القراءة قبل الكتابة', () => {
  it('كل get في actions/customerActions إما عبر readForUpdate أو موثّق كقراءة عرض فقط', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    for (const f of ['actions.ts', 'customerActions.ts']) {
      const src = readFileSync(join(import.meta.dirname, '..', 'src', 'data', f), 'utf8')
      const lenient = src.split('\n').filter((l) => l.includes('bridge.cf.get(') && !l.includes('function readForUpdate'))
      // المسموح: readForUpdate نفسها، قراءات العرض (readCloudFlags/readSupportChat/listSentNotices)، وسجل lic: أفضل جهد في الحرق
      for (const l of lenient) expect(l).toMatch(/r = await bridge\.cf\.get\(ns, key\)|flags:|chat:|lic:\$\{fingerprint\}|bridge\.cf\.get\(ns, k\)|bridge\.cf\.get\('license', k\)/)
    }
  })
})

