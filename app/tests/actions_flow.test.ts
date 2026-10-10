/**
 * اختبارات تكامل لمسارات البيانات الحقيقية (src/data/actions.ts + customerActions.ts)
 * فوق Cloudflare KV وهمي في الذاكرة، والتوقيع بالموقِّع الحقيقي من main.cjs.
 * كل اختبار يفحص ما يُكتب فعلاً في KV — نفس ما سيقرؤه البوت وتطبيق العميل.
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
const { verifyLicenseKey, keyFingerprint, decodeLicenseKey, expiresAfterDays } = await import('../src/core/license.ts')
const { buildCustomerViews } = await import('../src/core/customers.ts')

const DEV = 'SHOP-AB12-CD34-EF56'
const DEV2 = 'SHOP-ZZ99-YY88-XX77'
const today = () => new Date().toISOString().slice(0, 10)

function baseInput(over: Partial<Parameters<typeof actions.issueLicense>[0]> = {}): Parameters<typeof actions.issueLicense>[0] {
  return { deviceId: DEV, customer: 'بقالة النور', plan: 'basic', days: 30, features: [], ...over }
}

/** يبني عرض العملاء من KV الوهمي تماماً كما يفعل data.store */
function viewsFromKv() {
  const kv = h.fake.kv.license
  const pick = (prefix: string) => [...kv.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v] as const)
  return buildCustomerViews({
    devEntries: pick('dev:'), licEntries: pick('lic:'), logEntries: pick('log:'), emailEntries: [],
    chatEntries: [], revoked: h.fake.json<string[]>('license', 'revoked') ?? [], todayIso: today(),
  })
}

beforeEach(() => { h.fake.reset() })

describe('issueLicense — الإصدار وما يُكتب في KV', () => {
  it('جهاز جديد: يكتب lic: وdev: وlog: وsub: (بلا مفتاح)، والمفتاح يتحقق منه تطبيق العميل', async () => {
    const res = await actions.issueLicense(baseInput({ activityId: 'grocery', extraModules: ['cars'] }))
    const payload = await verifyLicenseKey(res.key, DEV, h.fake.signer.publicKeyB64u)
    expect(payload).toMatchObject({ deviceId: DEV, customer: 'بقالة النور', plan: 'basic', activityId: 'grocery', extraModules: ['cars'] })
    expect(payload.expiresAt).toBe(expiresAfterDays(30))
    expect(res.fingerprint).toBe(keyFingerprint(res.key))

    const lic = h.fake.json<{ key: string; revoked: boolean }>('license', `lic:${res.fingerprint}`)!
    expect(lic.key).toBe(res.key)
    expect(lic.revoked).toBe(false)
    expect(h.fake.json('license', `dev:${DEV}`)).toMatchObject({ plan: 'basic', fingerprint: res.fingerprint, activityId: 'grocery', message: '' })
    const log = h.fake.json<{ text: string }[]>('license', `log:${DEV}`)!
    expect(log).toHaveLength(1)
    expect(log[0].text).toContain('تفعيل basic')
    // sub: نسخة ثانوية لبوت الخدمات — بلا المفتاح ولا بصمته (لا يقرؤهما أحد)
    const sub = h.fake.json<Record<string, unknown>>('services', `sub:${DEV}`)!
    expect(sub).toMatchObject({ plan: 'basic' })
    expect(sub).not.toHaveProperty('key')
    expect(sub).not.toHaveProperty('fingerprint')
    expect(res.notes).toEqual([])
    expect(h.fake.audit.map((a) => a.action)).toEqual(['license_issue'])
  })

  it('الحقول الصفرية لا تدخل المفتاح، والميزات والأقسام المكررة تُزال', async () => {
    const res = await actions.issueLicense(baseInput({
      extraUsers: 0, extraBranches: 0, activityId: '',
      features: ['cloud_sync', 'cloud_sync', 'telegram_bot'], extraModules: ['pos', 'cars', 'pos', 'cars'],
    }))
    const { payload } = decodeLicenseKey(res.key)
    expect(payload).not.toHaveProperty('extraUsers')
    expect(payload).not.toHaveProperty('extraBranches')
    expect(payload).not.toHaveProperty('activityId')
    expect(payload.features.sort()).toEqual(['cloud_sync', 'telegram_bot'])
    expect(payload.extraModules).toEqual(['cars', 'pos'])
  })

  it('بطاقة sub: دمج لا استبدال: تحفظ ملاحظة العميل وأي حقل آخر، وتزيل key/fingerprint القديمين', async () => {
    h.fake.seed('services', `sub:${DEV}`, { plan: 'basic', expiresAt: null, message: 'العميل يطلب ترقية', extra: 1, key: 'OLDKEY', fingerprint: 'deadbeef' })
    await actions.issueLicense(baseInput({ plan: 'pro', days: 30 }))
    const sub = h.fake.json<Record<string, unknown>>('services', `sub:${DEV}`)!
    expect(sub).toMatchObject({ plan: 'pro', message: 'العميل يطلب ترقية', extra: 1 })
    expect(sub).not.toHaveProperty('key')
    expect(sub).not.toHaveProperty('fingerprint')
  })

  it('تعذر قراءة sub: ⇒ لا يُكتب فوقها (ملاحظة العميل تبقى)، والإصدار ينجح مع ملاحظة', async () => {
    h.fake.seed('services', `sub:${DEV}`, { plan: 'basic', message: 'ملاحظة مهمة' })
    h.fake.failGet.add(`services:sub:${DEV}`)
    const res = await actions.issueLicense(baseInput())
    expect(res.notes?.join(' ')).toContain('بطاقة الاشتراك')
    expect(h.fake.json('services', `sub:${DEV}`)).toMatchObject({ plan: 'basic', message: 'ملاحظة مهمة' })
    expect(h.fake.json('license', `lic:${res.fingerprint}`)).toMatchObject({ revoked: false })
  })

  it('مدى الحياة: expiresAt = null في المفتاح وdev: وsub:', async () => {
    const res = await actions.issueLicense(baseInput({ plan: 'lifetime', days: 999 }))
    expect(res.payload.expiresAt).toBeNull()
    expect(h.fake.json<{ expiresAt: unknown }>('license', `dev:${DEV}`)!.expiresAt).toBeNull()
    expect(h.fake.json<{ expiresAt: unknown }>('services', `sub:${DEV}`)!.expiresAt).toBeNull()
  })

  it('معرّف النشاط بحروف كبيرة يُوقَّع حرفياً (carParts لا يصير carparts)', async () => {
    const res = await actions.issueLicense(baseInput({ activityId: 'carParts' }))
    expect(decodeLicenseKey(res.key).payload.activityId).toBe('carParts')
    expect(h.fake.json<{ activityId: string }>('license', `dev:${DEV}`)!.activityId).toBe('carParts')
  })

  it('dev: يُكتب مع فهرس metadata بالشكل الذي يقرؤه البوت (التذكير اليومي لا ينهار)', async () => {
    await actions.issueLicense(baseInput({ customer: 'بقالة النور', plan: 'pro', days: 30 }))
    const meta = h.fake.meta.license.get(`dev:${DEV}`)
    expect(meta).toMatchObject({ v: 1, customer: 'بقالة النور', plan: 'pro' })
    expect(meta?.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('الرد على الدعم يكتب فهرس chat: كما يكتبه cloud worker (count/lastFrom/lastText)', async () => {
    h.fake.seed('services', `chat:${DEV}`, [{ id: 1, from: 'client', text: 'سؤال من العميل', at: '2026-10-09T10:00:00Z' }])
    await actions.replySupport(DEV, 'رد من المطوّر')
    expect(h.fake.meta.services.get(`chat:${DEV}`)).toEqual({
      v: 1, count: 2, lastFrom: 'developer', lastAt: expect.any(String), lastText: 'رد من المطوّر',
    })
  })

  it('يدمج سجل dev: ولا يستبدله: يحفظ ما كتبه التطبيق ويزيل disabledAt', async () => {
    h.fake.seed('license', `dev:${DEV}`, { lastSeenAt: '2026-10-01T10:00:00Z', email: 'a@b.c', appVersion: '3.2', disabledAt: '2026-09-01', message: 'موقوف', activityId: 'pharmacy' })
    await actions.issueLicense(baseInput())
    const dev = h.fake.json<Record<string, unknown>>('license', `dev:${DEV}`)!
    expect(dev).toMatchObject({ lastSeenAt: '2026-10-01T10:00:00Z', email: 'a@b.c', appVersion: '3.2', message: '' })
    expect(dev).not.toHaveProperty('disabledAt')
    // بلا نشاط في الإصدار → يبقى نشاط العميل كما هو
    expect(dev.activityId).toBe('pharmacy')
  })

  it('سجل الجهاز يتراكم ولا يتجاوز 200 سطر', async () => {
    h.fake.seed('license', `log:${DEV}`, Array.from({ length: 200 }, (_, i) => ({ at: '2026-01-01 00:00', text: `قديم ${i}` })))
    await actions.issueLicense(baseInput(), { renew: true })
    const log = h.fake.json<{ text: string }[]>('license', `log:${DEV}`)!
    expect(log).toHaveLength(200)
    expect(log[0].text).toBe('قديم 1')
    expect(log.at(-1)!.text).toContain('تجديد basic')
  })

  it('فشل التوقيع: يرمي ولا يكتب أي شيء في KV', async () => {
    h.fake.signFails = true
    await expect(actions.issueLicense(baseInput())).rejects.toThrow(/المفتاح الخاص/)
    expect(h.fake.stats.puts).toBe(0)
  })

  it('فشل كتابة lic: يرمي قبل تعديل dev: (لا سجل جهاز يشير لمفتاح غير محفوظ)', async () => {
    const fp = keyFingerprint(h.fake.signer.sign(JSON.stringify({ ...actions.previewPayload(baseInput()), features: [] })).key!)
    h.fake.failPut.add(`license:lic:${fp}`)
    await expect(actions.issueLicense(baseInput())).rejects.toThrow(/فشل كتابة/)
    expect(h.fake.kv.license.has(`dev:${DEV}`)).toBe(false)
  })

  it('مساحة الخدمات غير مضبوطة: المفتاح يصدر مع ملاحظة واضحة', async () => {
    h.fake.missingNs.add('services')
    const res = await actions.issueLicense(baseInput())
    expect(res.key).toMatch(/^SHOPSYS1\./)
    expect(res.notes).toEqual(['لم تُحدَّث بطاقة الاشتراك السحابية: مساحة الخدمات غير مضبوطة'])
  })

  it('حرق المفتاح السابق عند الإصدار: القديم في قائمتي الحرق وسجله revoked، والجديد سليم', async () => {
    const first = await actions.issueLicense(baseInput({ days: 10 }))
    const second = await actions.issueLicense(baseInput({ days: 40 }), { renew: true, burnFingerprint: first.fingerprint })
    for (const ns of ['license', 'services'] as const) {
      expect(h.fake.json<string[]>(ns, 'revoked')).toEqual([first.fingerprint])
    }
    expect(h.fake.json<{ revoked: boolean }>('license', `lic:${first.fingerprint}`)!.revoked).toBe(true)
    expect(h.fake.json<{ revoked: boolean }>('license', `lic:${second.fingerprint}`)!.revoked).toBe(false)
    expect(viewsFromKv()[0]).toMatchObject({ status: 'active', fingerprint: second.fingerprint, licenseKey: second.key })
  })

  it('لا يحرق المفتاح الجديد نفسه لو طُلب حرق بصمة مطابقة', async () => {
    const first = await actions.issueLicense(baseInput())
    const again = await actions.issueLicense(baseInput(), { burnFingerprint: first.fingerprint })
    expect(again.fingerprint).toBe(first.fingerprint)
    expect(h.fake.kv.license.has('revoked')).toBe(false)
    expect(viewsFromKv()[0].status).toBe('active')
  })

  it('🔴 إعادة تنشيط عميل معطّل بنفس البيانات في نفس اليوم: المفتاح الجديد لا يولد محروقاً', async () => {
    // Ed25519 حتمي — نفس الحمولة تعطي نفس المفتاح ونفس البصمة المحروقة
    const first = await actions.issueLicense(baseInput({ activityId: 'grocery' }))
    await customerActions.deactivateCustomer(viewsFromKv()[0])
    expect(viewsFromKv()[0].status).toBe('revoked')

    const re = await actions.issueLicense(baseInput({ activityId: 'grocery' }), { renew: true })
    const revoked = h.fake.json<string[]>('license', 'revoked')!
    expect(revoked).toContain(first.fingerprint)
    expect(revoked).not.toContain(re.fingerprint)
    expect(h.fake.json<string[]>('services', 'revoked')).not.toContain(re.fingerprint)
    expect(re.key).not.toBe(first.key)
    await verifyLicenseKey(re.key, DEV, h.fake.signer.publicKeyB64u)
    expect(viewsFromKv()[0]).toMatchObject({ status: 'active', fingerprint: re.fingerprint })
    expect(h.fake.json('license', `dev:${DEV}`)).not.toHaveProperty('disabledAt')
    expect(re.notes?.join(' ')).toMatch(/محروق/)
  })
})

describe('تصادم المفتاح المحروق — كل الحالات', () => {
  it('مدى الحياة: يصدر مفتاح مختلف بنفس الحدود تماماً (حقل اختياري صفري) وغير محروق', async () => {
    const first = await actions.issueLicense(baseInput({ plan: 'lifetime' }))
    await actions.revokeLicense(first.fingerprint)
    const re = await actions.issueLicense(baseInput({ plan: 'lifetime' }))
    expect(re.fingerprint).not.toBe(first.fingerprint)
    const payload = await verifyLicenseKey(re.key, DEV, h.fake.signer.publicKeyB64u)
    expect(payload.expiresAt).toBeNull()
    expect(payload.extraUsers ?? 0).toBe(0)
    expect(payload.extraBranches ?? 0).toBe(0)
    expect(re.notes?.join(' ')).toMatch(/بنفس الحدود/)
    // ما يُحفظ في lic: هو الحمولة الموقّعة فعلاً
    expect(h.fake.json<{ payload: unknown }>('license', `lic:${re.fingerprint}`)!.payload).toEqual(payload)
  })

  it('اشتراك بتاريخ: التمديد يوم واحد فقط، والتاريخ في dev: وsub: يطابق المفتاح', async () => {
    const first = await actions.issueLicense(baseInput({ days: 30 }))
    await actions.revokeLicense(first.fingerprint)
    const re = await actions.issueLicense(baseInput({ days: 30 }))
    const expected = expiresAfterDays(31)
    expect(decodeLicenseKey(re.key).payload.expiresAt).toBe(expected)
    expect(re.payload.expiresAt).toBe(expected)
    expect(h.fake.json<{ expiresAt: string }>('license', `dev:${DEV}`)!.expiresAt).toBe(expected)
    expect(h.fake.json<{ expiresAt: string }>('services', `sub:${DEV}`)!.expiresAt).toBe(expected)
  })

  it('بصمة محروقة في مساحة الخدمات فقط تُكتشف أيضاً', async () => {
    const first = await actions.issueLicense(baseInput())
    h.fake.seed('services', 'revoked', [first.fingerprint])
    const re = await actions.issueLicense(baseInput())
    expect(re.fingerprint).not.toBe(first.fingerprint)
  })

  it('بلا حرق سابق: لا تغيير في الحمولة ولا ملاحظات', async () => {
    const res = await actions.issueLicense(baseInput({ days: 30 }))
    expect(res.payload.expiresAt).toBe(expiresAfterDays(30))
    expect(res.notes).toEqual([])
  })
})

describe('revokeLicense / deactivateCustomer', () => {
  it('الحرق لا يكرر البصمة ويقبل المفتاح الكامل أو البصمة', async () => {
    const res = await actions.issueLicense(baseInput())
    await actions.revokeLicense(res.key)
    await actions.revokeLicense(res.fingerprint)
    expect(h.fake.json<string[]>('license', 'revoked')).toEqual([res.fingerprint])
    expect(h.fake.json<string[]>('services', 'revoked')).toEqual([res.fingerprint])
  })

  it('قائمة حرق تالفة في KV تُستبدل بقائمة صالحة بدل الانهيار', async () => {
    h.fake.seed('license', 'revoked', '{not json')
    h.fake.seed('services', 'revoked', '{"a":1}')
    await actions.revokeLicense('0badc0de')
    expect(h.fake.json('license', 'revoked')).toEqual(['0badc0de'])
    expect(h.fake.json('services', 'revoked')).toEqual(['0badc0de'])
  })

  it('التعطيل: يحرق ويكتب disabledAt ورسالة للعميل ويُسجّل في سجل الجهاز', async () => {
    await actions.issueLicense(baseInput())
    await customerActions.deactivateCustomer(viewsFromKv()[0])
    const dev = h.fake.json<Record<string, string>>('license', `dev:${DEV}`)!
    expect(dev.disabledAt).toBeTruthy()
    expect(dev.message).toContain('إيقاف')
    expect(h.fake.json<{ text: string }[]>('license', `log:${DEV}`)!.map((e) => e.text).join('|')).toContain('تعطيل من اللوحة')
    expect(viewsFromKv()[0].status).toBe('revoked')
  })

  it('تعطيل عميل بلا بصمة يرمي برسالة واضحة', async () => {
    h.fake.seed('license', `dev:${DEV}`, { customer: 'x' })
    await expect(customerActions.deactivateCustomer(viewsFromKv()[0])).rejects.toThrow(/لا توجد بصمة/)
  })
})

describe('lookupDevice / readGlobalDefaults', () => {
  it('lookupDevice يعيد العميل بمفتاحه ونشاطه وحالته', async () => {
    h.fake.seed('license', `dev:${DEV}`, { activityId: 'pharmacy' })
    const res = await actions.issueLicense(baseInput({ extraModules: ['lab'] }))
    const v = await actions.lookupDevice(DEV)
    expect(v).toMatchObject({ deviceId: DEV, customer: 'بقالة النور', clientActivityId: 'pharmacy', extraModules: ['lab'], licenseKey: res.key, status: 'active' })
    await actions.revokeLicense(res.fingerprint)
    expect((await actions.lookupDevice(DEV))!.status).toBe('revoked')
  })

  it('lookupDevice لجهاز غير موجود = null، وسجل تالف لا يكسر البحث', async () => {
    expect(await actions.lookupDevice(DEV2)).toBeNull()
    h.fake.seed('license', `dev:${DEV2}`, '{broken')
    expect((await actions.lookupDevice(DEV2))!.status).toBe('none')
  })

  it('readGlobalDefaults يقرأ settings:global ويسقط لقيم آمنة', async () => {
    expect(await actions.readGlobalDefaults()).toMatchObject({ plan: 'basic', days: 365 })
    h.fake.seed('license', 'settings:global', { plan: 'pro', days: 90, features: ['cloud_sync'], extraModules: ['pos', 7] })
    expect(await actions.readGlobalDefaults()).toEqual({ plan: 'pro', days: 90, features: ['cloud_sync'], extraUsers: 0, extraBranches: 0, extraModules: ['pos'] })
  })
})

describe('الإشعارات: إرسال / سجل / تعديل / حذف / إيصالات', () => {
  const customers = () => viewsFromKv()

  async function seedCustomers() {
    h.fake.seed('license', `dev:${DEV}`, { customer: 'أ', activityId: 'grocery', lastSeenAt: '2099-01-01T00:00:00Z' })
    h.fake.seed('license', `dev:${DEV2}`, { customer: 'ب', activityId: 'pharmacy' })
  }

  it('عام → notices:global فقط؛ نشاط → أجهزة النشاط فقط؛ مجموعة مكررة → مرة لكل جهاز', async () => {
    await seedCustomers()
    const g = await actions.sendNotice({ body: 'تحديث مهم للجميع', targeting: { type: 'all' }, customers: customers() })
    expect(g).toEqual({ targets: 2, mode: 'global', failed: [] })
    expect(h.fake.json<unknown[]>('license', 'notices:global')).toHaveLength(1)

    const a = await actions.sendNotice({ body: 'عرض للصيدليات', targeting: { type: 'activity', activityId: 'pharmacy' }, customers: customers() })
    expect(a).toEqual({ targets: 1, mode: 'devices', failed: [] })
    expect(h.fake.kv.license.has(`notices:${DEV2}`)).toBe(true)
    expect(h.fake.kv.license.has(`notices:${DEV}`)).toBe(false)

    await actions.sendNotice({ body: 'رسالة للمجموعة', targeting: { type: 'group', deviceIds: [DEV, DEV, DEV2] }, customers: customers() })
    expect(h.fake.json<unknown[]>('license', `notices:${DEV}`)).toHaveLength(1)
    expect(h.fake.json<unknown[]>('license', `notices:${DEV2}`)).toHaveLength(2)
  })

  it('نشاط بلا عملاء أو نص قصير → خطأ ولا كتابة', async () => {
    await seedCustomers()
    await expect(actions.sendNotice({ body: 'نص كافٍ', targeting: { type: 'activity', activityId: 'clinic' }, customers: customers() })).rejects.toThrow(/لا يوجد عملاء/)
    await expect(actions.sendNotice({ body: 'ab', targeting: { type: 'all' }, customers: customers() })).rejects.toThrow(/قصير/)
    expect([...h.fake.kv.license.keys()].some((k) => k.startsWith('notices:'))).toBe(false)
  })

  it('سجل المرسل: إشعار المجموعة يظهر مرة واحدة بكل أجهزته + الإيصالات + الترتيب الأحدث أولاً', async () => {
    await seedCustomers()
    await actions.sendNotice({ body: 'الأول', targeting: { type: 'group', deviceIds: [DEV, DEV2] }, customers: customers() })
    await new Promise((r) => setTimeout(r, 5))
    await actions.sendNotice({ body: 'الثاني', targeting: { type: 'all' }, customers: customers() })
    const firstId = h.fake.json<{ id: string }[]>('license', `notices:${DEV}`)![0].id
    // إقرار البوت: notice-acks:<id> = قائمة أجهزة أقرّت الإشعار
    h.fake.seed('license', `notice-acks:${firstId}`, [DEV2])

    const { notices, readsByDevice } = await actions.listSentNotices()
    expect(notices.map((n) => n.notice.body)).toEqual(['الثاني', 'الأول'])
    expect(notices[1]).toMatchObject({ scope: 'devices', deviceIds: [DEV, DEV2] })
    expect(notices[1].listKeys.sort()).toEqual([`notices:${DEV}`, `notices:${DEV2}`])
    expect(readsByDevice.get(DEV2)).toEqual({ [firstId]: '' })
    expect(readsByDevice.get(DEV)).toBeUndefined()
  })

  it('سجل المرسل مع آلاف المفاتيح: يتبع صفحات cursor ولا يتجاوز 8 طلبات متزامنة', async () => {
    h.fake.pageSize = 100
    for (let i = 0; i < 260; i++) {
      h.fake.seed('license', `notices:SHOP-${String(i).padStart(4, '0')}-AAAA-BBBB`, [{ id: `n${i}`, title: 't', body: 'body', createdAt: `2026-10-0${(i % 9) + 1}T00:00:00Z`, expiresAt: '2099-01-01T00:00:00Z' }])
    }
    h.fake.latencyMs = 1
    const { notices } = await actions.listSentNotices()
    expect(notices).toHaveLength(260)
    expect(h.fake.stats.lists).toBeGreaterThanOrEqual(3)
    expect(h.fake.stats.maxInFlight).toBeLessThanOrEqual(8)
  })

  it('التعديل: نفس المعرّف في كل القوائم، نص جديد وeditedAt، والإشعارات الأخرى لا تُمس', async () => {
    await seedCustomers()
    await actions.sendNotice({ body: 'إشعار آخر لا يتغير', targeting: { type: 'device', deviceId: DEV }, customers: customers() })
    await actions.sendNotice({ body: 'نص قديم', targeting: { type: 'group', deviceIds: [DEV, DEV2] }, customers: customers() })
    const target = (await actions.listSentNotices()).notices.find((n) => n.notice.body === 'نص قديم')!
    await actions.editNotice(target, { title: '  ', body: 'نص جديد' })
    for (const id of [DEV, DEV2]) {
      const list = h.fake.json<{ id: string; title: string; body: string; editedAt?: string }[]>('license', `notices:${id}`)!
      const edited = list.find((n) => n.id === target.notice.id)!
      expect(edited.body).toBe('نص جديد')
      expect(edited.title).toBe('رسالة من المطوّر')
      expect(edited.editedAt).toBeTruthy()
    }
    const other = h.fake.json<{ body: string; editedAt?: string }[]>('license', `notices:${DEV}`)!.find((n) => n.body === 'إشعار آخر لا يتغير')!
    expect(other.editedAt).toBeUndefined()
    await expect(actions.editNotice(target, { body: 'x' })).rejects.toThrow(/قصير/)
  })

  it('التعديل/الحذف يحافظ على عناصر القائمة التي لا تفهمها اللوحة (لا فقد بيانات)', async () => {
    const odd = { id: 'odd', text: 'صيغة قديمة من البوت بلا body' }
    h.fake.seed('license', `notices:${DEV}`, [odd, { id: 'n1', title: 't', body: 'نص أصلي', createdAt: '2026-10-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z' }])
    const sent = (await actions.listSentNotices()).notices[0]
    await actions.editNotice(sent, { body: 'نص معدّل' })
    expect(h.fake.json<unknown[]>('license', `notices:${DEV}`)).toContainEqual(odd)
    await actions.deleteNotice(sent)
    expect(h.fake.json<unknown[]>('license', `notices:${DEV}`)).toEqual([odd])
  })

  it('الحذف من كل القوائم (عام + أجهزة) دون مس غيره', async () => {
    await seedCustomers()
    await actions.sendNotice({ body: 'يبقى', targeting: { type: 'all' }, customers: customers() })
    await actions.sendNotice({ body: 'يُحذف', targeting: { type: 'all' }, customers: customers() })
    const del = (await actions.listSentNotices()).notices.find((n) => n.notice.body === 'يُحذف')!
    await actions.deleteNotice(del)
    expect(h.fake.json<{ body: string }[]>('license', 'notices:global')!.map((n) => n.body)).toEqual(['يبقى'])
    expect(h.fake.audit.at(-1)!.action).toBe('notice_delete')
  })

  it('فشل الكتابة أثناء الحذف يرمي (لا نجاح كاذب)', async () => {
    await seedCustomers()
    await actions.sendNotice({ body: 'نص الإشعار', targeting: { type: 'device', deviceId: DEV }, customers: customers() })
    const sent = (await actions.listSentNotices()).notices[0]
    h.fake.failPut.add(`license:notices:${DEV}`)
    await expect(actions.deleteNotice(sent)).rejects.toThrow(/فشل كتابة/)
  })

  it('إرسال المفتاح للعميل: إشعار في قائمة جهازه فقط يحتوي المفتاح كاملاً', async () => {
    await seedCustomers()
    const res = await actions.issueLicense(baseInput())
    await actions.sendKeyToCustomer({ deviceId: DEV, customer: 'أ', key: res.key, fingerprint: res.fingerprint, summary: 'أساسي حتى ...' })
    const list = h.fake.json<{ body: string; title: string }[]>('license', `notices:${DEV}`)!
    expect(list).toHaveLength(1)
    expect(list[0].body).toContain(res.key)
    expect(list[0].title).toContain('مفتاح')
    expect(h.fake.kv.license.has('notices:global')).toBe(false)
    expect(h.fake.kv.license.has(`notices:${DEV2}`)).toBe(false)
    // سجل التدقيق لا يحفظ المفتاح نفسه
    expect(JSON.stringify(h.fake.audit)).not.toContain(res.key)
  })
})
