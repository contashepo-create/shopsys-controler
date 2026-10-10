/**
 * اختبارات الوحدات النقية: كلمة المرور، OTP، نموذج العملاء، الإشعارات،
 * الدعم، عميل KV (بـ fetch مزيّف)، وأدوات البوت.
 */
import { describe, it, expect, vi } from 'vitest'
import { hashPassword, verifyPassword, validatePasswordStrength, generateSalt } from '../src/core/password.ts'
import { generateOtpCode, hashOtp, createPendingOtp, checkOtp, isOtpExpired, buildOtpMessage, OTP_LENGTH } from '../src/core/otp.ts'
import { buildCustomerViews, computeStatus, parseDevRecord, parseLicRecord, appendDeviceLogEntry, isValidPlan, sortCustomers, filterCustomers, type CustomerView } from '../src/core/customers.ts'
import { buildNotice, appendNotice, parseNoticeList, resolveTargetDevices, validateNoticeBody, describeTargeting } from '../src/core/notices.ts'
import { appendChatMessage, parseChat, hasUnreadFromClient, cleanSupportText, validateReply, CHAT_KEEP } from '../src/core/support.ts'
import { createKvClient, listAllKeys, KvError } from '../src/core/kv.ts'
import { isValidBotToken, isValidChatId, maskToken, buildOtpSendError } from '../src/core/telegramAdmin.ts'
import {
  isValidCfAccountId, isValidCfNamespaceId, validateProfile, isHttpsUrl,
  suggestNamespaceRoles, servicesBindingSnippet,
} from '../src/core/settings.ts'
import { sanitizeDetails, describeAudit } from '../src/core/audit.ts'
import { issueActivityChangeKey, ACTIVITY_KEY_PREFIX, b64uDecode } from '../src/core/license.ts'

/* ─── كلمة المرور ─── */

/**
 * كلمات مرور اختبارية — تُبنى وقت التشغيل عمداً من مقاطع مفصولة، ولا تُكتب كنصّ جاهز
 * داخل المستودع. السبب: أي نصّ يشبه سرّاً حقيقياً يُشعل ماسحات الأسرار (GitGuardian رفع
 * تنبيهاً على قيمة ثابتة كانت هنا)، والاختبار لا يعتمد على القيمة نفسها إطلاقاً.
 * وبوابة `npm run verify:secrets` تمنع عودة أي نصّ «مشبع» داخل نداء كلمة مرور.
 */
const TEST_PASSPHRASE = ['test', 'fixture', 'only'].join('-') + '-2026'
const TEST_PASSPHRASE_SHORT = ['sa', 'me'].join('') + '-password'

describe('كلمة مرور اللوحة', () => {
  it('تُخزَّن بصمة PBKDF2 + ملح عشوائي، والتحقق يعمل', async () => {
    const stored = await hashPassword(TEST_PASSPHRASE)
    expect(stored.iterations).toBeGreaterThan(100_000)
    expect(stored.salt).not.toBe(await generateSalt())
    expect(await verifyPassword(TEST_PASSPHRASE, stored)).toBe(true)
    expect(await verifyPassword('mismatch', stored)).toBe(false)
    expect(await verifyPassword('', stored)).toBe(false)
  })

  it('نفس كلمة المرور بملحين مختلفين ⇒ بصمتان مختلفتان', async () => {
    const a = await hashPassword(TEST_PASSPHRASE_SHORT)
    const b = await hashPassword(TEST_PASSPHRASE_SHORT)
    expect(a.hash).not.toBe(b.hash)
    expect(a.salt).not.toBe(b.salt)
  })

  it('التحقق يفشل مع بصمة مُعدَّلة', async () => {
    const stored = await hashPassword(TEST_PASSPHRASE)
    const tampered = { ...stored, hash: stored.hash.slice(0, -1) + (stored.hash.endsWith('a') ? 'b' : 'a') }
    expect(await verifyPassword(TEST_PASSPHRASE, tampered)).toBe(false)
  })

  it('قواعد القوة', () => {
    expect(validatePasswordStrength('short')).not.toBeNull()
    expect(validatePasswordStrength('a'.repeat(129))).not.toBeNull()
    expect(validatePasswordStrength('long-enough-8')).toBeNull()
  })
})

/* ─── OTP ─── */

describe('رمز الاستعادة عبر البوت', () => {
  it('الرمز 6 أرقام دائماً', () => {
    for (let i = 0; i < 50; i++) expect(generateOtpCode()).toMatch(new RegExp(`^\\d{${OTP_LENGTH}}$`))
  })

  it('يُخزَّن كبصمة SHA-256 ولا يُقارن نصاً', async () => {
    const code = '123456'
    const h = await hashOtp(code)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toContain(code)
    expect(await hashOtp(' 123456 ')).toBe(h) // trim
  })

  it('الدورة الكاملة: صحيح / خاطئ / منتهٍ / مقفل', async () => {
    const code = '246810'
    const otp = createPendingOtp(await hashOtp(code))
    expect(await checkOtp(otp, '111111')).toBe('wrong')
    expect(await checkOtp(otp, code)).toBe('ok')

    const expired = createPendingOtp(await hashOtp(code))
    expired.expiresAt = Date.now() - 1000
    expect(isOtpExpired(expired)).toBe(true)
    expect(await checkOtp(expired, code)).toBe('expired')

    const locked = createPendingOtp(await hashOtp(code))
    locked.attempts = 3
    expect(await checkOtp(locked, code)).toBe('locked')
  })

  it('نص رسالة البوت يحمل الرمز والمدة', () => {
    const msg = buildOtpMessage('مركز تحكم المطور', '654321', 'استعادة كلمة المرور')
    expect(msg).toContain('654321')
    expect(msg).toContain('استعادة كلمة المرور')
    expect(msg).toContain('5')
  })
})

/* ─── نموذج العملاء ─── */

const today = '2026-10-08'

function dev(over: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({ plan: 'basic', expiresAt: '2027-01-01', customer: 'بقالة النور', message: '', fingerprint: 'aaaa1111', ...over })
}

describe('نموذج العملاء (رصد + بحث)', () => {
  it('حالات الاشتراك: نشط / قرب الانتهاء / منتهٍ / مدى الحياة', () => {
    expect(computeStatus({ plan: 'basic', expiresAt: '2027-01-01', todayIso: today })).toBe('active')
    expect(computeStatus({ plan: 'basic', expiresAt: '2026-10-10', todayIso: today })).toBe('expiring')
    expect(computeStatus({ plan: 'basic', expiresAt: '2026-10-01', todayIso: today })).toBe('expired')
    expect(computeStatus({ plan: 'lifetime', expiresAt: null, todayIso: today })).toBe('active')
    expect(computeStatus({ todayIso: today })).toBe('none')
    expect(computeStatus({ plan: 'basic', expiresAt: '2027-01-01', revokedFingerprint: true, todayIso: today })).toBe('revoked')
  })

  it('بناء العرض من سجلات KV الخام (نفس تنسيقات البوت)', () => {
    const lic = JSON.stringify({
      payload: { v: 1, deviceId: 'SHOP-AAAA-BBBB-CCCC', customer: 'بقالة النور', plan: 'pro', features: ['telegram_bot'], issuedAt: '2026-01-01', expiresAt: '2027-01-01', activityId: 'grocery', extraModules: ['pos'] },
      key: 'SHOPSYS1.aaa.bbbbbbbb', issuedAt: '2026-01-01', revoked: false,
    })
    const views = buildCustomerViews({
      devEntries: [['SHOP-AAAA-BBBB-CCCC', dev()]],
      licEntries: [['aaaa1111', lic]],
      logEntries: [['SHOP-AAAA-BBBB-CCCC', JSON.stringify([{ at: '2026-10-07 22:10', text: 'تفعيل' }])]],
      emailEntries: [['owner@shop.com', 'SHOP-AAAA-BBBB-CCCC']],
      chatEntries: [['SHOP-AAAA-BBBB-CCCC', JSON.stringify([{ id: 1, from: 'client', text: 'سلام', at: '2026-10-08T10:00:00Z' }])]],
      revoked: [],
      todayIso: today,
    })
    expect(views).toHaveLength(1)
    const v = views[0]
    expect(v.customer).toBe('بقالة النور')
    expect(v.email).toBe('owner@shop.com')
    expect(v.plan).toBe('pro')
    expect(v.activityId).toBe('grocery')
    expect(v.extraModules).toEqual(['pos'])
    expect(v.lastActivityAt).toBe('2026-10-07 22:10')
    expect(v.lastSupportAt).toBe('2026-10-08T10:00:00Z')
    expect(v.status).toBe('active')
  })

  it('سجل غير صالح لا يكسر العرض', () => {
    expect(parseDevRecord('{ليس JSON')).toEqual({})
    expect(parseDevRecord(null)).toEqual({})
    expect(parseLicRecord('{}')).toBeNull()
  })

  it('سجل الجهاز بنفس شكل البوت (حد 200)', () => {
    let raw: string | null = null
    for (let i = 0; i < 205; i++) raw = appendDeviceLogEntry(raw, `حدث ${i}`, '2026-10-08T12:00:00Z')
    const list = JSON.parse(raw as string) as unknown[]
    expect(list).toHaveLength(200)
    expect((list[0] as { text: string }).text).toBe('حدث 5')
  })

  it('البحث والترتيب والفلاتر', () => {
    const base: CustomerView = {
      deviceId: 'SHOP-AAAA-BBBB-CCCC', customer: 'بقالة النور', email: null, plan: 'basic', expiresAt: '2027-01-01',
      activityId: 'grocery', clientActivityId: null, features: [], extraUsers: 0, extraBranches: 0, extraModules: [], fingerprint: null, licenseKey: null, licenseIssuedAt: null, lastSeenAt: null,
      status: 'active', lastActivityAt: null, lastSupportAt: null, message: '',
    }
    const list = [base, { ...base, deviceId: 'SHOP-DDDD-EEEE-FFFF', customer: 'صيدلية الشفاء', status: 'expired' as const }, { ...base, deviceId: 'SHOP-GGGG-HHHH-IIII', customer: 'مطعم', status: 'revoked' as const }]
    expect(filterCustomers(list, 'صيدلية')).toHaveLength(1)
    expect(filterCustomers(list, '', 'expired')).toHaveLength(1)
    expect(filterCustomers(list, 'shop-dddd')).toHaveLength(1) // search by device id
    expect(filterCustomers(list, 'grocery')).toHaveLength(3)
    const sorted = sortCustomers(list, 'customer')
    expect(sorted[0].customer).toBe('بقالة النور')
  })

  it('isValidPlan يحصر القيم المسموحة', () => {
    expect(isValidPlan('pro')).toBe(true)
    expect(isValidPlan('لifetime')).toBe(false)
    expect(isValidPlan('gold')).toBe(false)
  })
})

/* ─── الإشعارات ─── */

describe('الإشعارات (4 أهداف)', () => {
  it('يبنى بشكل يطابق notices:global تماماً', () => {
    const n = buildNotice({ body: 'تحديث جديد', title: 'صيانة' }, new Date('2026-10-08T09:00:00Z'))
    expect(n.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(n.title).toBe('صيانة')
    expect(n.createdAt).toBe('2026-10-08T09:00:00.000Z')
    expect(Date.parse(n.expiresAt as string)).toBeGreaterThan(Date.parse(n.createdAt))
  })

  it('appendNotice: يُسقط المنتهي ويحتفظ بآخر 50 (نفس دالة البوت)', () => {
    const frozenNow = new Date('2026-01-05T00:00:00Z')
    let raw: string | null = null
    for (let i = 0; i < 55; i++) raw = appendNotice(raw, buildNotice({ body: `إشعار ${i}` }, frozenNow), frozenNow)
    const list = parseNoticeList(raw)
    expect(list).toHaveLength(50)
    expect(list[0].body).toBe('إشعار 5')

    const expiredList = JSON.stringify([{ id: 'x', title: 't', body: 'منتهي', createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-02-01T00:00:00Z' }])
    const after = parseNoticeList(appendNotice(expiredList, buildNotice({ body: 'جديد' }, new Date('2026-10-08T00:00:00Z')), new Date('2026-10-08T00:00:00Z')))
    expect(after).toHaveLength(1)
    expect(after[0].body).toBe('جديد')
  })

  it('الاستهداف: الكل ⇒ عام، والباقي ⇒ قائمة أجهزة', () => {
    const customers = [
      { deviceId: 'SHOP-AAAA-BBBB-CCCC', activityId: 'grocery' },
      { deviceId: 'SHOP-DDDD-EEEE-FFFF', activityId: 'pharmacy' },
      { deviceId: 'SHOP-GGGG-HHHH-IIII', activityId: 'grocery' },
    ] as CustomerView[]
    expect(resolveTargetDevices({ type: 'all' }, customers)).toEqual({ mode: 'global' })
    expect(resolveTargetDevices({ type: 'device', deviceId: 'SHOP-AAAA-BBBB-CCCC' }, customers)).toEqual({ mode: 'devices', deviceIds: ['SHOP-AAAA-BBBB-CCCC'] })
    expect(resolveTargetDevices({ type: 'group', deviceIds: ['a', 'a', 'b'] }, customers)).toEqual({ mode: 'devices', deviceIds: ['a', 'b'] })
    expect(resolveTargetDevices({ type: 'activity', activityId: 'grocery' }, customers)).toEqual({ mode: 'devices', deviceIds: ['SHOP-AAAA-BBBB-CCCC', 'SHOP-GGGG-HHHH-IIII'] })
    expect(describeTargeting({ type: 'activity', activityId: 'grocery' }, customers)).toContain('2')
  })

  it('التحقق من النص', () => {
    expect(validateNoticeBody('ab')).not.toBeNull()
    expect(validateNoticeBody('نص كافٍ')).toBeNull()
    expect(validateNoticeBody('x'.repeat(1501))).not.toBeNull()
  })
})

/* ─── الدعم ─── */

describe('قناة الدعم (نفس تنسيق chat:)', () => {
  it('الإضافة تعيّن id = max+1 وتحتفظ بآخر 200', () => {
    let raw = appendChatMessage(null, 'client', 'أول رسالة')
    for (let i = 0; i < CHAT_KEEP + 5; i++) raw = appendChatMessage(raw, i % 2 ? 'client' : 'developer', `رسالة ${i}`)
    const chat = parseChat(raw)
    expect(chat).toHaveLength(CHAT_KEEP)
    // المعرّفات تتصاعد ولا تُعاد من الصفر بعد التقليم (نفس سلوك الـ worker)
    expect(chat[chat.length - 1].id).toBe(CHAT_KEEP + 6)
    expect(chat[0].id).toBe(7)
  })

  it('كشف الرسائل غير المقروءة (آخر رسالة من العميل)', () => {
    let raw = appendChatMessage(null, 'client', 'بلاغ')
    expect(hasUnreadFromClient(parseChat(raw))).toBe(true)
    raw = appendChatMessage(raw, 'developer', 'تم')
    expect(hasUnreadFromClient(parseChat(raw))).toBe(false)
    expect(hasUnreadFromClient([])).toBe(false)
  })

  it('تنظيف النص كما يفعل الـ worker ويقطع الطويل', () => {
    expect(cleanSupportText('  نص\u0000به\u0007حروف  ')).toBe('نصبهحروف')
    expect(cleanSupportText('x'.repeat(5000)).length).toBe(4000)
    expect(validateReply('a')).not.toBeNull()
    expect(validateReply('رد واضح')).toBeNull()
  })

  it('محادثة تالفة لا تكسر القراءة', () => {
    expect(parseChat('{ليس')).toEqual([])
    expect(parseChat('[{"id":"x"}]')).toEqual([])
  })
})

/* ─── عميل KV ─── */

describe('عميل Cloudflare KV', () => {
  const cfg = { accountId: 'a'.repeat(32), apiToken: 'tok', namespaces: { license: 'ns-lic', services: 'ns-svc' } }

  it('listKeys يستدعي العنوان الصحيح ويمرر الكيرسور', async () => {
    const calls: string[] = []
    const fakeFetch = vi.fn(async (url: string) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ success: true, result: [{ name: 'dev:X' }], result_info: { cursor: '' } }), { status: 200 })
    }) as unknown as typeof fetch
    const client = createKvClient(cfg, fakeFetch)
    const res = await client.listKeys('license', 'dev:')
    expect(res.keys).toEqual(['dev:X'])
    expect(res.cursor).toBeNull()
    expect(calls[0]).toContain(`/accounts/${cfg.accountId}/storage/kv/namespaces/ns-lic/keys?prefix=dev%3A&limit=1000`)
  })

  it('get: 404 ⇒ null (لا خطأ)', async () => {
    const fakeFetch = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
    const client = createKvClient(cfg, fakeFetch)
    expect(await client.get('license', 'nothing')).toBeNull()
  })

  it('put يرسل PUT بجسم نصي', async () => {
    let seen: { url: string; init?: RequestInit } = { url: '' }
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seen = { url: String(url), init }
      return new Response(JSON.stringify({ success: true, result: null }), { status: 200 })
    }) as unknown as typeof fetch
    const client = createKvClient(cfg, fakeFetch)
    await client.put('services', 'chat:SHOP-1', '{"a":1}')
    expect(seen.init?.method).toBe('PUT')
    expect(seen.init?.body).toBe('{"a":1}')
    expect(seen.url).toContain('/values/chat%3ASHOP-1')
  })

  it('401 ⇒ رسالة عربية واضحة', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ success: false, errors: [{ message: 'Invalid token' }] }), { status: 401 })) as unknown as typeof fetch
    const client = createKvClient(cfg, fakeFetch)
    await expect(client.get('license', 'x')).rejects.toThrow(KvError)
    await expect(client.get('license', 'x')).rejects.toThrow(/مرفوض|غير صالح/)
  })

  it('مساحة ناقصة ⇒ خطأ برمز ns_missing قبل أي طلب', async () => {
    const client = createKvClient({ ...cfg, namespaces: { license: '', services: '' } }, (async () => new Response('')) as unknown as typeof fetch)
    await expect(client.get('license', 'x')).rejects.toMatchObject({ code: 'ns_missing' })
    await expect(client.get('license', 'x')).rejects.toThrow(/غير مضبوطة/)
  })

  it('listAllKeys يتبع الصفحات حتى النهاية', async () => {
    const pages = [
      { success: true, result: [{ name: 'a' }, { name: 'b' }], result_info: { cursor: 'next' } },
      { success: true, result: [{ name: 'c' }], result_info: { cursor: '' } },
    ]
    let i = 0
    const fakeFetch = (async () => new Response(JSON.stringify(pages[i++]), { status: 200 })) as unknown as typeof fetch
    const client = createKvClient(cfg, fakeFetch)
    expect(await listAllKeys(client, 'license', 'dev:')).toEqual(['a', 'b', 'c'])
  })
})

/* ─── أدوات البوت والإعدادات ─── */

describe('أدوات البوت والإعدادات', () => {
  it('صيغة توكن البوت ومعرّف المحادثة', () => {
    // توكن وهمي مبني من أجزاء، وبمقاطع مكرّرة لا عشوائية — فلا يشبه أي توكن حقيقي
    const fakeToken = ['8123456789', 'x'.repeat(35)].join(':')
    expect(isValidBotToken(fakeToken)).toBe(true)
    expect(isValidBotToken('not-a-token')).toBe(false)
    expect(isValidBotToken('123:short')).toBe(false)
    expect(isValidChatId('123456789')).toBe(true)
    expect(isValidChatId('-1001234567890')).toBe(true)
    expect(isValidChatId('abc')).toBe(false)
  })

  it('التوكن يُعرض مقنّعاً دائماً', () => {
    const t = ['8123456789', 'x'.repeat(35)].join(':')
    const masked = maskToken(t)
    expect(masked).toContain('…')
    expect(masked).not.toBe(t)
    expect(masked.length).toBeLessThan(t.length)
  })

  it('رسائل خطأ الإرسال واضحة بالعربية', () => {
    expect(buildOtpSendError('Bad Request: chat not found')).toContain('المحادثة')
    expect(buildOtpSendError('Unauthorized')).toContain('التوكن')
  })

  it('التحقق من معرّفات Cloudflare والملف الشخصي', () => {
    expect(isValidCfAccountId('a1'.repeat(16))).toBe(true)
    expect(isValidCfAccountId('not-hex')).toBe(false)
    expect(isValidCfNamespaceId('3ed24436e5844f3d9159b5b823cf9b65')).toBe(true)
    expect(isHttpsUrl('https://x.workers.dev')).toBe(true)
    expect(isHttpsUrl('http://x')).toBe(false)
    expect(validateProfile({ name: '', phone: '', email: '' })).not.toBeNull()
    expect(validateProfile({ name: 'م / محمد', phone: '+20 100 000 0000', email: 'a@b.com' })).toBeNull()
    expect(validateProfile({ name: 'م', phone: 'abc', email: '' })).not.toBeNull()
    expect(validateProfile({ name: 'م', phone: '', email: 'bad-email' })).not.toBeNull()
  })

  it('سجل التدقيق يحجب الأسرار' , () => {
    const cleaned = sanitizeDetails({ botToken: 'secret', cfApiToken: 'x', privateKeyB64u: 'y', password: 'z', plan: 'pro', note: 'a'.repeat(250) })
    expect(cleaned).not.toHaveProperty('botToken')
    expect(cleaned).not.toHaveProperty('cfApiToken')
    expect(cleaned).not.toHaveProperty('privateKeyB64u')
    expect(cleaned).not.toHaveProperty('password')
    expect(cleaned.plan).toBe('pro')
    expect(String(cleaned.note)).toHaveLength(201)
    expect(describeAudit({ action: 'license_issue', target: 'SHOP-X', at: '' })).toContain('إصدار مفتاح')
  })
  it('سجل قديم بإجراء أُزيل (version_update) يُعرض باسمه الخام ولا ينهار', () => {
    expect(describeAudit({ action: 'version_update' as never, target: '', at: '' })).toBe('version_update')
  })
})

/* ─── مفتاح تغيير النشاط (SHOPSYS2) ─── */

describe('مفتاح تغيير النشاط', () => {
  it('يُبنى بالبنية SHOPSYS2 ويُفكّ بنفس الحمولة', async () => {
    const priv = 'MC4CAQAwBQYDK2VwBCIEIIUlHsUUZufbayCDB2dZLSNHKlR9wgviKGLTl84dZVfy'
    const key = await issueActivityChangeKey({ v: 1, deviceId: 'SHOP-AAAA-BBBB-CCCC', fromActivityId: 'grocery', toActivityId: 'pharmacy', issuedAt: '2026-10-08' }, priv)
    const parts = key.split('.')
    expect(parts[0]).toBe(ACTIVITY_KEY_PREFIX)
    expect(parts).toHaveLength(3)
    const decoded = JSON.parse(new TextDecoder().decode(b64uDecode(parts[1])))
    expect(decoded.toActivityId).toBe('pharmacy')
    expect(parts[2]).not.toContain('=')
  })
})

/* ─── اكتشاف مساحات KV وترشيح الأدوار ─── */

describe('اكتشاف مساحات Cloudflare وترشيحها', () => {
  const ns = (title: string, id: string) => ({ id, title })

  it('يطابق الأسماء الرسمية بدقة', () => {
    const list = [ns('SHOPSYS_CONTROL', 'a'.repeat(32)), ns('SHOPSYS_KV', 'b'.repeat(32))]
    const out = suggestNamespaceRoles(list)
    expect(out.find((x) => x.role === 'license')).toMatchObject({ namespaceId: 'a'.repeat(32), confidence: 'exact' })
    expect(out.find((x) => x.role === 'services')).toMatchObject({ namespaceId: 'b'.repeat(32), confidence: 'exact' })
  })

  it('يبقى ما هو مضبوط حالياً ولا يغيّره', () => {
    const list = [ns('SHOPSYS_CONTROL', 'c'.repeat(32)), ns('SHOPSYS_KV', 'd'.repeat(32))]
    const out = suggestNamespaceRoles(list, { license: 'c'.repeat(32), services: '' })
    expect(out.find((x) => x.role === 'license')?.namespaceId).toBe('c'.repeat(32))
    expect(out.find((x) => x.role === 'services')?.namespaceId).toBe('d'.repeat(32))
  })

  it('أسماء مختلفة: يرجّح من الكلمات المميزة (CONTROL / KV)', () => {
    const list = [ns('shopsys-control-prod', 'e'.repeat(32)), ns('global-kv-store', 'f'.repeat(32))]
    const out = suggestNamespaceRoles(list)
    expect(out.find((x) => x.role === 'license')).toMatchObject({ namespaceId: 'e'.repeat(32), confidence: 'guess' })
    expect(out.find((x) => x.role === 'services')).toMatchObject({ namespaceId: 'f'.repeat(32), confidence: 'guess' })
  })

  it('غياب مساحة الخدمات ⇒ none (هذه حالة المالك الآن) + إرشاد بالنص المتوقع', () => {
    const list = [ns('SHOPSYS_CONTROL', '1'.repeat(32))]
    const out = suggestNamespaceRoles(list)
    const services = out.find((x) => x.role === 'services')
    expect(services?.namespaceId).toBeNull()
    expect(services?.confidence).toBe('none')
    expect(services?.reasonAr).toContain('SHOPSYS_KV')
  })

  it('مساحة واحدة حرّة بلا علامة مميزة ⇒ تُمنح للتراخيص (الأساسية)', () => {
    const list = [ns('my-store-data', '2'.repeat(32))]
    const out = suggestNamespaceRoles(list)
    expect(out.find((x) => x.role === 'license')).toMatchObject({ namespaceId: '2'.repeat(32), confidence: 'guess' })
    expect(out.find((x) => x.role === 'services')?.namespaceId).toBeNull()
  })

  it('مساحة واحدة باسم يحتوي KV ⇒ تُرشَّح للخدمات (العلامة المميزة تُقدَّم)', () => {
    const list = [ns('my-kv-store', '3'.repeat(32))]
    const out = suggestNamespaceRoles(list)
    expect(out.find((x) => x.role === 'services')).toMatchObject({ namespaceId: '3'.repeat(32), confidence: 'guess' })
    expect(out.find((x) => x.role === 'license')?.namespaceId).toBeNull()
  })

  it('حساب فارغ ⇒ لا ترشيحات ولا انهيار', () => {
    const out = suggestNamespaceRoles([])
    expect(out).toHaveLength(2)
    expect(out.every((x) => x.namespaceId === null)).toBe(true)
  })

  it('مقتطف الربط يحتوي الصيغة الصحيحة للـ wrangler', () => {
    const snippet = servicesBindingSnippet('9'.repeat(32))
    expect(snippet).toContain('cloud/wrangler.toml')
    expect(snippet).toContain('binding = "SHOPSYS_KV"')
    expect(snippet).toContain(`id = "${'9'.repeat(32)}"`)
    expect(snippet).toContain('wrangler deploy')
  })
})

/* ─── رموز أخطاء KV ─── */

describe('رموز أخطاء مساحات KV', () => {
  const cfg = { accountId: 'a'.repeat(32), apiToken: 'tok', namespaces: { license: '', services: 'svc' } }

  it('مساحة التراخيص الناقصة ⇒ كود ns_missing برسالة إرشادية', async () => {
    const client = createKvClient(cfg, (async () => new Response('')) as unknown as typeof fetch)
    await expect(client.get('license', 'x')).rejects.toMatchObject({ code: 'ns_missing' })
    await expect(client.get('license', 'x')).rejects.toThrow(/الإعدادات/)
  })

  it('مساحة الخدمات الناقصة ⇒ كود ns_missing بالاسم الصريح', async () => {
    const client = createKvClient({ ...cfg, namespaces: { license: 'lic', services: '' } }, (async () => new Response('')) as unknown as typeof fetch)
    await expect(client.get('services', 'chat:X')).rejects.toThrow(/SHOPSYS_KV/)
  })

  it('غياب المساحة لا يستهلك أي طلب شبكة', async () => {
    let calls = 0
    const fakeFetch = (async () => { calls += 1; return new Response('') }) as unknown as typeof fetch
    const client = createKvClient(cfg, fakeFetch)
    await client.get('license', 'x').catch(() => {})
    expect(calls).toBe(0)
  })
})
