/**
 * فحص توافق «مركز تحكم المطوّر» (هذا الريبو) مع تطبيق «تَحَكَّم» (ريبو shopsys).
 * يستورد النواتين الحقيقيتين من الريبوين ويشغّل الفحوص على الكود الفعلي — لا نسخ ولا تقليد.
 *
 * التشغيل (من جذر هذا الريبو):
 *   git clone --depth 300 https://github.com/contashepo-create/shopsys.git /tmp/shopsys-ref
 *   cd app && npx tsx ../docs/أدلة_التوافق_2026-10-10/compat_check.mts
 * (أو ضع SHOPSYS_DIR=<مسار الريبو> لو كان في مكان آخر)
 *
 * الخروج: 0 إذا نجحت كل الفحوص، و1 إذا وُجد ❌ (فجوة) — صالح كبوابة في CI.
 *   على الأساس قبل الـpatches يُتوقع خروج 1 (الفجوات الموثّقة في التقرير المجاور).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateKeyPairSync } from 'node:crypto'

const here = path.dirname(fileURLToPath(import.meta.url))
const CTRL = path.resolve(here, '../../app/src/core')
const SHOP = path.join(process.env.SHOPSYS_DIR ?? '/tmp/shopsys-ref', 'app/src/core')
const SHOP_BOT = path.join(process.env.SHOPSYS_DIR ?? '/tmp/shopsys-ref', 'tools/devbot/src')

const load = (p: string) => import(p)
const C = await load(path.join(CTRL, 'license.ts'))
const CN = await load(path.join(CTRL, 'notices.ts'))
const CA = await load(path.join(CTRL, 'activities.ts'))
const CS = await load(path.join(CTRL, 'support.ts'))
const S = await load(path.join(SHOP, 'license.ts'))
const SC = await load(path.join(SHOP, 'cloud.ts'))
const SF = await load(path.join(SHOP, 'featureFlags.ts'))
const SS = await load(path.join(SHOP, 'support.ts'))
const SA = await load(path.join(SHOP, 'activities.ts'))
const BOT = await load(path.join(SHOP_BOT, 'adminPanel.js'))

let fails = 0
const check = (label: string, cond: boolean, extra = '') => {
  if (!cond) fails++
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`)
}
const section = (t: string) => console.log(`\n── ${t} ──`)

/* 1) التوقيع والبصمة والنشاط (نواة الترخيص) */
section('1. الترخيص: التوقيع والبصمة والنشاط')
{
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privB64u = C.b64uEncode(new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs8' })))
  const raw = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  const pubB64u = C.b64uEncode(new Uint8Array(raw.subarray(raw.length - 32)))
  const deviceId = 'SHOP-AAAA-BBBB-CCCC'
  const base = { v: 1 as const, deviceId, customer: 'محل', plan: 'basic' as const, features: ['telegram_bot', 'cloud_sync'], issuedAt: '2026-10-10', expiresAt: '2027-10-10' }

  const key = await C.issueLicenseKey({ ...base }, privB64u)
  const v = await S.verifyLicenseKey(key, deviceId, pubB64u).then(() => true, () => false)
  check('مفتاح صادر من اللوحة يتحقق عند التطبيق الأصلي', v)
  check('بصمة المفتاح القياسي متطابقة بين اللوحة والتطبيق', C.keyFingerprint(key) === S.keyFingerprint(key))

  const keyFactory = await C.issueLicenseKey({ ...base, activityId: 'factory' }, privB64u)
  const rejected = await S.acceptActivationKey({ key: keyFactory, deviceId, revokedKeys: [], activityId: 'manufacturing', pubB64u }).then(() => false, () => true)
  check('نشاط «factory» (من اللوحة) عند عميل «manufacturing» ⇒ يُرفض', rejected, 'اللوحة تُصدر معرّفاً غير معروف للتطبيق')

  const parts = key.split('.')
  const sig = parts[2]
  const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const mall = [parts[0], parts[1], sig.slice(0, -1) + B[B.indexOf(sig.at(-1)) ^ 0b1111]].join('.')
  const mallOk = await S.verifyLicenseKey(mall, deviceId, pubB64u).then(() => true, () => false)
  const same = C.keyFingerprint(mall) === S.keyFingerprint(mall)
  check('بصمة المفتاح المُلدَّن متطابقة بين اللوحة والتطبيق (ح1)', same, mallOk ? 'التوقيع يقبل التلدين والتطبيق يطبّع البصمة' : '')
}

/* 2) معرّفات الأنشطة والأقسام */
section('2. الأنشطة والأقسام')
{
  const appIds = new Set((SA.ACTIVITY_TEMPLATES as { id: string }[]).map((t) => t.id))
  const panelIds = (CA.ACTIVITY_CATALOG as { id: string }[]).map((a) => a.id)
  const unknown = panelIds.filter((id) => !appIds.has(id))
  check('كل أنشطة اللوحة معروفة للتطبيق', unknown.length === 0, unknown.length ? `غير معروفة: ${unknown.join('، ')}` : '')
  const missing = [...appIds].filter((id) => !panelIds.includes(id))
  check('كل أنشطة التطبيق متاحة في اللوحة', missing.length === 0, missing.length ? `غائبة: ${missing.join('، ')}` : '')

  const table = CA.ACTIVITY_MODULES as Record<string, string[]>
  let differing = 0
  const total = Object.keys(table).filter((id) => appIds.has(id)).length
  for (const id of Object.keys(table).filter((x) => appIds.has(x))) {
    const app = (SA.ACTIVITY_TEMPLATES as { id: string; modules: string[] }[]).find((t) => t.id === id)!.modules
    const p = [...table[id]].sort().join(',')
    if (p !== [...app].sort().join(',')) differing++
  }
  check('الأقسام المضمّنة في كل نشاط متطابقة بين اللوحة والتطبيق', differing === 0, `${differing} من ${total} نشاطاً مشتركاً مختلفة`)
}

/* 3) الإشعارات */
section('3. الإشعارات')
{
  const now = Date.now()
  const future = new Date(now + 90 * 86400000).toISOString()
  const urgent = { id: 'urgent-1', title: 'عاجل', body: 'يلزم إقرار', level: 'critical', requiresAck: true, createdAt: new Date(now - 3600e3).toISOString(), expiresAt: future }
  const list: unknown[] = [urgent]
  for (let i = 0; i < 60; i++) list.push({ id: `info-${i}`, title: 't', body: 'b', level: 'info', requiresAck: false, createdAt: new Date(now - 3600e3 + (i + 1) * 1000).toISOString(), expiresAt: future })
  const botKept = (BOT as { capNotices: (l: unknown[]) => { id: string }[] }).capNotices(list)
  check('البوت: التنبيه العاجل محفوظ بعد 60 إعلاناً أحدث منه', botKept.some((n) => n.id === 'urgent-1'))
  const afterPanel = JSON.parse(CN.appendNotice(JSON.stringify(botKept), CN.buildNotice({ title: 'من اللوحة', body: 'نص' }))) as { id: string }[]
  check('كتابة اللوحة فوق القائمة لا تُسقط تنبيهاً عاجلاً', afterPanel.some((n) => n.id === 'urgent-1'), afterPanel.some((n) => n.id === 'urgent-1') ? '' : 'اللوحة تقصّ بـslice(-50) بلا وعي بالدرجات')

  const panelNotice = CN.buildNotice({ title: 'x', body: 'نص' })
  const parsed = SC.parseCloudNotices([panelNotice])
  check('اللوحة تستطيع إرسال تنبيه «مهم» أو «عاجل» (حقل level)', (panelNotice as { level?: unknown }).level !== undefined, `الإشعار يصل التطبيق بدرجة «${parsed[0]?.level}» مهما اخترت`)

  const panelAckKey = CN.NOTICE_ACK_PREFIX
  const botAckKey = (BOT as { ACK_PREFIX: string }).ACK_PREFIX
  check(`مفتاح إيصالات القراءة في اللوحة (${panelAckKey}) = مفتاح البوت (${botAckKey})`, panelAckKey === botAckKey, 'اللوحة تقرأ مفتاحاً لا يكتبه البوت')
}

/* 4) مسارات تعمل: about / revoked / flags / support */
section('4. المسارات الصحيحة (تكتب اللوحة ⟶ يقرأ التطبيق)')
{
  const about = SC.parseAbout(JSON.parse(JSON.stringify({ title: 'تحكم', body: 'نص', supportPhone: '+201000000000', supportTelegram: 'shop_support', website: 'https://example.com' })))
  check('/about: الحقول الخمسة تصل', about.supportPhone === '+201000000000' && about.supportTelegram === 'shop_support' && about.website === 'https://example.com')
  check('/revoked: البصمة تُقبل', SC.parseRevocationList(['4a60e88b']).length === 1)
  const flags = SF.parseDeviceFlags({ disabledFeatures: ['cloud_sync'], noteAr: '', updatedAt: '' })
  check('/flags: الميزة المطفأة تُقرأ', flags.disabledFeatures.includes('cloud_sync'))
  const chat = CS.appendChatMessage(JSON.stringify([{ id: 1, from: 'client', text: 'سؤال', at: new Date().toISOString() }]), 'developer', 'رد من اللوحة')
  const conv = SS.parseConversation(JSON.parse(chat)) as { from: string }[]
  check('/support: رد المطوّر يُقرأ عند العميل', conv.length === 2 && conv.at(-1)?.from === 'developer')
}

/* 5) فجوات قراءة الإشعارات */
section('5. قراءة الإشعارات ولوحة «آخر ظهور»')
{
  // ما يكتبه البوت فعلاً عند إقرار الإشعار: notice-acks:<noticeId> = [deviceId, ...]
  const botKv = new Map<string, string>([[`${(BOT as { ACK_PREFIX: string }).ACK_PREFIX}n1`, JSON.stringify(['SHOP-AAAA-BBBB-CCCC'])]])
  // ما تقرؤه اللوحة (نفس منطق actions.ts): تقلب القوائم إلى «جهاز ← إشعارات أقرّها»
  const readsByDevice = new Map<string, Record<string, string>>()
  for (const [k, raw] of botKv) {
    if (!k.startsWith(CN.NOTICE_ACK_PREFIX)) continue
    const noticeId = k.slice(CN.NOTICE_ACK_PREFIX.length)
    for (const dev of CN.parseNoticeAcks(raw)) readsByDevice.set(dev, { ...(readsByDevice.get(dev) ?? {}), [noticeId]: '' })
  }
  const sent = { notice: { id: 'n1', title: '', body: '', createdAt: new Date().toISOString(), expiresAt: null }, scope: 'global' as const, deviceIds: [], listKeys: [] }
  const customers = [{ deviceId: 'SHOP-AAAA-BBBB-CCCC', customer: 'x', lastSeenAt: null }]
  const st = CN.noticeRecipients(sent, customers, readsByDevice)[0]?.state
  check('العميل قرأ الإشعار (ack البوت) ⇒ تُظهره اللوحة «قرأه»', st === 'read', `الحالة الظاهرة للوحة: ${st}`)
  // «آخر ظهور»: فحص مصدري — هل يكتب البوت/العامل lastSeenAt في أي سجل؟ (يجب أن يكون لا شيء)
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const scanDir = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f)
    return statSync(p).isDirectory() ? scanDir(p) : /\.(js|ts)$/.test(f) ? [p] : []
  })
  const root = process.env.SHOPSYS_DIR ?? '/tmp/shopsys-ref'
  // كاتب «آخر ظهور» الحقيقي = ملف يكتب dev:<id> ويذكر lastSeenAt (سجلات التسجيل reg: لا تُحسب)
  const writers = [...scanDir(path.join(root, 'tools/devbot/src')), path.join(root, 'cloud/worker.js')]
    .filter((p) => { const t = readFileSync(p, 'utf8'); return t.includes('lastSeenAt') && t.includes('`dev:') })
  check('«آخر ظهور» يُكتب في dev:<id>.lastSeenAt من البوت/العامل', writers.length > 0, writers.length ? '' : 'لا كاتب لـdev:<id>.lastSeenAt (خطة المرحلة 0 لم تُنفَّذ)')
}

/* 6) فحوص المصدر: ما لا يُختبر بالتشغيل بسهولة */
section('6. فحوص المصدر (كتابة اللوحة ⟷ هيكل البيانات)')
{
  const { readFileSync, readdirSync, statSync } = await import('node:fs')
  const read = (p: string) => readFileSync(p, 'utf8')
  const ctrlRoot = path.resolve(here, '../../app/src')
  const contentPage = read(path.join(ctrlRoot, 'ui/pages/ContentPage.tsx'))
  const shopAbout = read(path.join(SHOP_BOT, 'aboutContent.js'))
  const structured = ['supportWhatsapp', 'supportEmail', 'address', 'workHours', 'socialLinks', 'extraFields']
  const loaded = structured.filter((f) => contentPage.includes(f))
  check('«حول»: اللوحة تحمّل كل حقول المستند قبل الحفظ (لا تكتب فوقها ناقصاً)', loaded.length === structured.length,
    `تحمّل ${loaded.length} من ${structured.length} — البوت يكتب ${structured.filter((f) => shopAbout.includes(f)).length} حقلاً منها`)

  const kvSrc = read(path.join(ctrlRoot, 'core/kv.ts'))
  check('الكتابة في KV تحفظ metadata (فهرس الاشتراكات والمحادثات للبوت)', /metadata/.test(kvSrc), 'البوت يعتمد metadata للتذكير اليومي؛ اللوحة تمسحها')

  const appRoot = path.join(process.env.SHOPSYS_DIR ?? '/tmp/shopsys-ref', 'app/src')
  const scanTs = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f); return statSync(p).isDirectory() ? scanTs(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })
  // إطفاء الميزات من اللوحة: هل يُطبَّق على غير cloud_sync؟ (مواقع الاستهلاك = ما يستورد featureFlags)
  // سلوكي (لا نصّي): لكل ميزة مُطفأة سحابياً، هل يرفضها hasFeature عند العميل وهو يحمل مفتاحاً موقّعاً يمنحها؟
  const enforcedFeatures = ['einvoice_sa', 'einvoice_eg', 'telegram_bot', 'multi_branch', 'multi_user_lan', 'cloud_sync']
  const probe = { v: 1, deviceId: 'SHOP-AAAA-BBBB-CCCC', customer: 'x', plan: 'pro', features: enforcedFeatures, issuedAt: '2026-10-01', expiresAt: null }
  const setFlags = (SF as { setActiveDeviceFlags?: (f: unknown) => void }).setActiveDeviceFlags
  const enforced = enforcedFeatures.filter((f) => {
    setFlags?.({ disabledFeatures: [f], noteAr: '', updatedAt: '' })
    const st = S.evaluateLicense({ activatedPayload: probe, trialStartedAt: '2026-10-01', lastSeenAt: '2026-10-09', today: '2026-10-10' })
    const blocked = !S.hasFeature(st, f as never)
    setFlags?.(null)
    return blocked
  })
  check(`الإطفاء من اللوحة يُطبَّق على كل الميزات التي تعرضها (${enforcedFeatures.length} ميزات)`, enforced.length === enforcedFeatures.length,
    enforced.length === enforcedFeatures.length ? '' : `يُطبَّق على ${enforced.length} فقط — بقية الإطفاءات بلا أثر عند العميل`)
  const readsVersion = scanTs(appRoot).some((p) => /['"`]\/version['"`]/.test(read(p)) || /\/version\b[^-]/.test(read(p)) && /fetch/.test(read(p)))
  // قرار المستخدم: التحديثات تأتي تلقائياً من GitHub Releases، وزر «نشر تحديث» أُزيل من اللوحة.
  // الفحص يتأكد أن اللوحة لا تكتب services:version (مسار لا يصل العملاء) ولا تعرض الزر.
  const panelSrc = [read(path.join(ctrlRoot, 'data/actions.ts')), read(path.join(ctrlRoot, 'ui/pages/ContentPage.tsx'))].join('\n')
  const publishesVersion = /services:version|updateVersion|نشر تحديث/.test(panelSrc)
  check('اللوحة لا تنشر «تحديث» عبر Cloudflare (التحديثات من GitHub Releases تلقائياً)', !publishesVersion, publishesVersion ? 'ما زال زر/مسار «نشر تحديث» موجوداً في اللوحة' : '')
  void readsVersion
}

console.log(`\nالنتيجة: ${fails === 0 ? 'كل الفحوص نجحت' : `${fails} فحص(اً) يكشف فجوة موثّقة في التقرير`}`)
process.exitCode = fails === 0 ? 0 : 1
