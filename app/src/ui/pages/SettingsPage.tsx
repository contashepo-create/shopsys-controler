import { useEffect, useState } from 'react'
import { bridge, isDesktop } from '../../data/bridge.ts'
import { useConfigStore } from '../../stores/config.store.ts'
import { useSessionStore } from '../../stores/session.store.ts'
import { maskToken, isValidBotToken, isValidChatId } from '../../core/telegramAdmin.ts'
import { isValidCfAccountId, isValidCfNamespaceId, validateProfile, DEFAULT_BINDING, LICENSE_NS_DEFAULT } from '../../core/settings.ts'
import { audit } from '../../data/actions.ts'
import { Btn, Field, useToast, Badge, ConfirmDialog } from '../components/ui.tsx'
import { DEV_PUBLIC_KEY_LABEL } from '../../core/licenseInfo.ts'

export function SettingsPage() {
  const toast = useToast()
  const { profile, setProfile, theme, setTheme } = useSessionStore()
  const { cfAccountId, cfNsLicense, cfNsServices, hasCfToken, hasPrivateKey, publicKeyMatches, adminChatId, hasBotToken, botUsername, saveSecrets, refreshBot } = useConfigStore()

  const [name, setName] = useState(profile?.name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [email, setEmail] = useState(profile?.email ?? '')

  const [accountId, setAccountId] = useState(cfAccountId)
  const [nsLicense, setNsLicense] = useState(cfNsLicense || LICENSE_NS_DEFAULT)
  const [nsServices, setNsServices] = useState(cfNsServices)
  const [cfToken, setCfToken] = useState('')

  const [token, setToken] = useState('')
  const [chatId, setChatId] = useState(adminChatId)

  const [privateKey, setPrivateKey] = useState('')
  const [keyStatus, setKeyStatus] = useState<{ present: boolean; matchesPublic: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [cfTesting, setCfTesting] = useState(false)
  const [confirmForget, setConfirmForget] = useState(false)

  useEffect(() => { setAccountId(cfAccountId); setNsLicense(cfNsLicense || LICENSE_NS_DEFAULT); setNsServices(cfNsServices); setChatId(adminChatId) }, [cfAccountId, cfNsLicense, cfNsServices, adminChatId])
  useEffect(() => { void bridge.license.checkKey().then(setKeyStatus) }, [hasPrivateKey])

  async function saveProfile() {
    const err = validateProfile({ name, phone, email })
    if (err) { toast(err, 'error'); return }
    setBusy(true)
    try {
      await bridge.profile.save({ name: name.trim(), phone: phone.trim(), email: email.trim() })
      setProfile({ name: name.trim(), phone: phone.trim(), email: email.trim() })
      await audit('profile_update', undefined, {})
      toast('تم تحديث بيانات الحساب ✓', 'ok')
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  async function saveCloudflare() {
    if (accountId && !isValidCfAccountId(accountId)) { toast('Account ID يجب أن يكون 32 حرفاً hex', 'error'); return }
    if (nsLicense && !isValidCfNamespaceId(nsLicense)) { toast('namespace الترخيص يجب أن يكون 32 حرفاً hex', 'error'); return }
    if (nsServices && !isValidCfNamespaceId(nsServices)) { toast('namespace الخدمات يجب أن يكون 32 حرفاً hex', 'error'); return }
    setBusy(true)
    try {
      await saveSecrets({
        ...(cfToken ? { cfApiToken: cfToken } : {}),
        cfAccountId: accountId.trim(), cfNsLicense: nsLicense.trim(), cfNsServices: nsServices.trim(),
      })
      await audit('cf_settings_update', undefined, { accountId: accountId.trim() })
      toast('تم حفظ إعدادات Cloudflare ✓', 'ok')
      setCfToken('')
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  async function testCloudflare() {
    setCfTesting(true)
    try {
      const res = await bridge.cf.test()
      toast(res.ok ? '✅ الاتصال بـ Cloudflare KV يعمل' : `تعذر الاتصال: ${res.error ?? ''}`, res.ok ? 'ok' : 'error')
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setCfTesting(false)
  }

  async function saveBot() {
    if (token && !isValidBotToken(token)) { toast('صيغة التوكن غير صحيحة', 'error'); return }
    if (chatId && !isValidChatId(chatId)) { toast('معرّف المحادثة يجب أن يكون رقماً', 'error'); return }
    setBusy(true)
    try {
      await saveSecrets({ ...(token ? { botToken: token } : {}), adminChatId: chatId.trim() })
      await refreshBot()
      await audit('bot_settings_update', undefined, {})
      toast('تم حفظ إعدادات البوت ✓', 'ok')
      setToken('')
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  async function importKey() {
    const value = privateKey.trim()
    if (!value) { toast('الصق المفتاح الخاص أولاً', 'error'); return }
    setBusy(true)
    try {
      await saveSecrets({ privateKeyB64u: value })
      await audit('key_import', undefined, {})
      const check = await bridge.license.checkKey()
      setKeyStatus(check)
      setPrivateKey('')
      if (check.present && !check.matchesPublic) {
        toast('⚠️ المفتاح محفوظ لكنه لا يطابق المفتاح العام في التطبيق — لن تُقبل المفاتيح الصادرة به', 'error')
      } else {
        toast('✅ تم استيراد المفتاح الخاص — التوقيع يتم محلياً الآن', 'ok')
      }
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="card">
        <div className="card-title">👤 بيانات مطوّر اللوحة</div>
        <Field label="الاسم" value={name} onChange={setName} />
        <Field label="رقم الهاتف" value={phone} onChange={setPhone} dir="ltr" />
        <Field label="البريد الإلكتروني" value={email} onChange={setEmail} dir="ltr" />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            <Btn size="sm" kind={theme === 'dark' ? 'primary' : 'default'} onClick={() => setTheme('dark')}>🌙 ليلي</Btn>
            <Btn size="sm" kind={theme === 'light' ? 'primary' : 'default'} onClick={() => setTheme('light')}>☀️ نهاري</Btn>
          </div>
          <Btn kind="primary" disabled={busy} onClick={() => void saveProfile()}>حفظ الحساب</Btn>
        </div>
      </div>

      <div className="card">
        <div className="card-title">🔐 كلمة مرور اللوحة</div>
        <div className="card" style={{ fontSize: 13.5, marginBlockEnd: 12 }}>
          🔑 لاستعادة كلمة المرور أو تغييرها: رمز تحقق (6 أرقام) يُرسل إلى <b>محادثة البوت</b> على تليجرام —
          لن يدخل أحد غيرك لأن الأمر محصور بمعرّف المطوّر.
          {hasBotToken && adminChatId ? <div className="muted" style={{ marginBlockStart: 6 }}>البوت جاهز {botUsername ? ` (@${botUsername})` : ''} — يمكنك الاستعادة الآن.</div>
            : <div className="muted" style={{ marginBlockStart: 6 }}>⚠️ أكمل إعدادات البوت بالأسفل أولاً حتى تعمل الاستعادة.</div>}
        </div>
        <Btn onClick={() => toast('استخدم زر «نسيت كلمة المرور؟» في شاشة القفل، أو اقفل اللوحة ثم اضغطه', 'info')}>طلب رمز التغيير</Btn>
        <div className="hr" />
        <div className="muted" style={{ fontSize: 12.5 }}>
          حماية إضافية: رمز OTP صالح 5 دقائق، و3 محاولات كحد أقصى، والرمز لا يُخزَّن نصاً (بصمة SHA-256 فقط).
        </div>
      </div>

      <div className="card">
        <div className="card-title">☁️ إعدادات Cloudflare <Badge kind={hasCfToken && cfAccountId ? 'ok' : 'warn'}>{hasCfToken && cfAccountId ? 'مضبوط' : 'ناقص'}</Badge></div>
        <Field label="Account ID" value={accountId} onChange={setAccountId} mono hint="32 حرفاً hex" />
        <Field label="API Token" value={cfToken} onChange={setCfToken} type="password" mono hint={hasCfToken ? 'محفوظ مشفراً — اكتب توكن جديداً للتغيير' : 'بصلاحية KV Read & Write على الاسمين'} />
        <div className="grid-2">
          <Field label="namespace الترخيص" value={nsLicense} onChange={setNsLicense} mono hint="SHOPSYS_CONTROL — الافتراضي من البوت" />
          <Field label="namespace الخدمات" value={nsServices} onChange={setNsServices} mono hint="SHOPSYS_KV — للدعم والأعلام و«حول»" />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Btn onClick={() => void testCloudflare()} disabled={cfTesting || !hasCfToken}>{cfTesting ? 'جارٍ الاختبار…' : 'اختبار الاتصال'}</Btn>
          <Btn kind="primary" disabled={busy} onClick={() => void saveCloudflare()}>حفظ إعدادات Cloudflare</Btn>
        </div>
      </div>

      <div className="card">
        <div className="card-title">🤖 إعدادات البوت والتليجرام</div>
        <Field label="توكن البوت" value={token} onChange={setToken} type="password" mono hint={hasBotToken ? 'محفوظ مشفراً — اكتب توكن جديداً للتغيير' : 'من BotFather'} />
        <Field label="معرّف محادثة المطوّر" value={chatId} onChange={setChatId} mono hint="Chat ID الخاص بك — وجهة رموز التحقق والإشعارات" />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Btn onClick={() => void refreshBot()} disabled={!hasBotToken}>فحص الاتصال</Btn>
          <Btn kind="primary" disabled={busy} onClick={() => void saveBot()}>حفظ إعدادات البوت</Btn>
        </div>
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <div className="card-title">🔑 مفتاح التوقيع الخاص (Ed25519)
          {keyStatus ? <Badge kind={keyStatus.present ? (keyStatus.matchesPublic && publicKeyMatches ? 'ok' : 'danger') : 'warn'}>
            {keyStatus.present ? (keyStatus.matchesPublic ? 'مطابق للمفتاح العام ✓' : 'غير مطابق للمفتاح العام!') : 'غير مُستورد'}
          </Badge> : null}
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginBlockEnd: 12 }}>
          يُخزَّن <b>مشفَّراً على جهازك</b> (Windows DPAPI عبر safeStorage) ولا يُرسل لأي جهة ولا يُكتب في git أو السجلات.
          استورد هنا فقط إن لم يكن مستورداً بعد. {!isDesktop() ? ' (في المتصفح غير متاح)' : ''}
        </div>
        <Field label="الصق المفتاح الخاص (base64url / pkcs8)" value={privateKey} onChange={setPrivateKey} type="password" mono
          hint={`سيُتحقق منه مقابل المفتاح العام: ${DEV_PUBLIC_KEY_LABEL}`} />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Btn kind="danger" onClick={() => setConfirmForget(true)} disabled={!keyStatus?.present}>حذف المفتاح من الجهاز</Btn>
          <Btn kind="primary" disabled={busy || !privateKey.trim()} onClick={() => void importKey()}>استيراد المفتاح</Btn>
        </div>
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <div className="card-title">🔗 الربط بالـ Worker والتطبيق</div>
        <ul className="plain" style={{ fontSize: 13.5 }}>
          <li>Worker الترخيص: <span className="mono">{DEFAULT_BINDING.licenseWorkerUrl}</span></li>
          <li>Worker الخدمات: <span className="mono">{DEFAULT_BINDING.servicesWorkerUrl}</span></li>
        </ul>
        <div className="muted" style={{ fontSize: 12.5, marginBlockStart: 8 }}>
          هذه العناوين ثابتة من مشروع تَحَكَّم — لا تُغيّرها إلا إذا أعدت نشر الـ workers على نطاق جديد.
        </div>
      </div>

      <ConfirmDialog
        open={confirmForget}
        title="حذف المفتاح الخاص من هذا الجهاز"
        message="لن تستطيع إصدار مفاتيح جديدة حتى تستورد المفتاح مرة أخرى. المفاتيح الصادرة سابقاً تبقى تعمل عند العملاء."
        confirmText="حذف"
        danger
        onCancel={() => setConfirmForget(false)}
        onConfirm={async () => {
          setConfirmForget(false)
          try {
            await saveSecrets({ privateKeyB64u: '' })
            setKeyStatus(await bridge.license.checkKey())
            toast('تم حذف المفتاح من الجهاز', 'ok')
          } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
        }}
      />
    </div>
  )
}

export { maskToken }
