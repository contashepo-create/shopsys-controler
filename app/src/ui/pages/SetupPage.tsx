import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { bridge } from '../../data/bridge.ts'
import { hashPassword, validatePasswordStrength, type PasswordHash } from '../../core/password.ts'
import { validateProfile, DEFAULT_BINDING, LICENSE_NS_DEFAULT } from '../../core/settings.ts'
import { useSessionStore } from '../../stores/session.store.ts'
import { useConfigStore } from '../../stores/config.store.ts'
import { Field, Btn, useToast } from '../components/ui.tsx'

/**
 * First-run setup: (1) developer account (name / phone / email — like the user asked),
 * (2) panel password, (3) owner contact + Cloudflare basics.
 * The Telegram recovery link gets configured later in Settings; if the bot is set up
 * at this point we offer to send a welcome message right away.
 */
export function SetupPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { profile, setProfile, unlock } = useSessionStore()
  const { saveSecrets, hasBotToken } = useConfigStore()
  const [step, setStep] = useState(0)

  const [name, setName] = useState(profile?.name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [email, setEmail] = useState(profile?.email ?? '')

  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')

  const [cfAccountId, setCfAccountId] = useState('')
  const [cfToken, setCfToken] = useState('')
  const [cfNsLicense, setCfNsLicense] = useState(LICENSE_NS_DEFAULT)

  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (step === 2 && hasBotToken) {
      void bridge.tg.send('✅ تم إنشاء حساب المطوّر في مركز تحكم المطور')
    }
  }, [step, hasBotToken])

  async function finishAccount() {
    const err = validateProfile({ name, phone, email })
    if (err) { toast(err, 'error'); return }
    if (busy) return
    setBusy(true)
    try {
      await bridge.profile.save({ name: name.trim(), phone: phone.trim(), email: email.trim() })
      setProfile({ name: name.trim(), phone: phone.trim(), email: email.trim() })
      setStep(1)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function finishPassword() {
    const err = validatePasswordStrength(pw1)
    if (err) { toast(err, 'error'); return }
    if (pw1 !== pw2) { toast('كلمتا المرور غير متطابقتين', 'error'); return }
    if (busy) return
    setBusy(true)
    try {
      const h: PasswordHash = await hashPassword(pw1)
      await bridge.auth.setPassword(h)
      // تأكيد أن ما حُفظ يُفتح فعلاً بنفس الكلمة (قبل التحقق الصحيح بالملح كانت هذه الخطوة تمر دائماً)
      const check = await bridge.auth.verifyPassword(pw1)
      if (!check.ok) { toast('تعذر التحقق من كلمة المرور المحفوظة — أعد المحاولة', 'error'); return }
      setStep(2)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function finishCloudflare(skip: boolean) {
    if (!skip) {
      if (!cfAccountId.trim() || !cfToken.trim()) { toast('أدخل Account ID و API Token أو اختر التخطي', 'error'); return }
      setBusy(true)
      try {
        await saveSecrets({ cfAccountId: cfAccountId.trim(), cfApiToken: cfToken.trim(), cfNsLicense: cfNsLicense.trim() })
        const test = await bridge.cf.test()
        if (!test.ok) { toast(`تعذر الاتصال بـ Cloudflare: ${test.error ?? ''}`, 'error'); setBusy(false); return }
        toast('تم ربط Cloudflare بنجاح ✓', 'ok')
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
        setBusy(false)
        return
      }
      setBusy(false)
    }
    unlock()
    navigate('/dashboard')
  }

  async function verifyAndContinue() {
    // safety check that the password was persisted (التحقق بالملح المخزّن في العملية الرئيسية)
    try {
      const res = await bridge.auth.verifyPassword(pw1)
      if (!res.ok) toast('تعذر حفظ كلمة المرور — أعد المحاولة', 'error')
      else { unlock(); navigate('/dashboard') }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  return (
    <div className="center-screen">
      <div className="panel-box wide">
        <div className="row" style={{ justifyContent: 'space-between', marginBlockEnd: 12 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 19 }}>إنشاء حساب المطوّر</div>
            <div className="muted" style={{ fontSize: 13 }}>مركز تحكم المطور — Shopsys Controler</div>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>{DEFAULT_BINDING.licenseWorkerUrl}</div>
        </div>

        <div className="steps">
          <div className={`step ${step === 0 ? 'active' : step > 0 ? 'done' : ''}`}>1) الحساب</div>
          <div className={`step ${step === 1 ? 'active' : step > 1 ? 'done' : ''}`}>2) كلمة المرور</div>
          <div className={`step ${step === 2 ? 'active' : ''}`}>3) Cloudflare</div>
        </div>

        {step === 0 ? (
          <>
            <Field label="الاسم" value={name} onChange={setName} placeholder="م / محمد عبدة" required />
            <div className="grid-2">
              <Field label="رقم الهاتف" value={phone} onChange={setPhone} placeholder="+20 1x xxx xxxx" dir="ltr" />
              <Field label="البريد الإلكتروني" value={email} onChange={setEmail} placeholder="you@example.com" dir="ltr" />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Btn kind="primary" onClick={finishAccount}>التالي</Btn>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Field label="كلمة مرور اللوحة" value={pw1} onChange={setPw1} type="password" hint="8 أحرف على الأقل — ستُطلب منك في كل تشغيل" required />
            <Field label="تأكيد كلمة المرور" value={pw2} onChange={setPw2} type="password" required />
            <div className="card" style={{ marginBlockEnd: 12, fontSize: 13 }}>
              🔑 <b>نسيت كلمة المرور؟</b> يتم استعادة الحساب عبر إرسال رمز تحقق إلى بوت تليجرام الخاص بك
              (يُضبط في الإعدادات) — نفس الطريقة ستستخدمها لاحقاً لتغيير كلمة المرور.
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <Btn onClick={() => setStep(0)}>رجوع</Btn>
              <Btn kind="primary" onClick={finishPassword}>التالي</Btn>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="card" style={{ marginBlockEnd: 14, fontSize: 13.5 }}>
              هذه البيانات تُحفظ <b>مشفرة على جهازك فقط</b> (Windows DPAPI) ولا تُكتب في git ولا تُرسل لأي جهة.
            </div>
            <Field label="Cloudflare Account ID" value={cfAccountId} onChange={setCfAccountId} mono placeholder="32 حرفاً hex" hint="من صفحة Workers & Pages ← Accounts" />
            <Field label="Cloudflare API Token" value={cfToken} onChange={setCfToken} type="password" mono placeholder="توكن بصلاحية KV Read & Write" hint="يُخزَّن مشفراً — يُعرض مقنّعاً دائماً" />
            <Field label="namespace الترخيص (SHOPSYS_CONTROL)" value={cfNsLicense} onChange={setCfNsLicense} mono hint="الافتراضي جاهز — نفس namespace البوت" />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <Btn onClick={() => void finishCloudflare(true)} disabled={busy}>تخطٍ — أضبطها لاحقاً</Btn>
              <div className="row">
                <Btn onClick={() => setStep(1)}>رجوع</Btn>
                <Btn kind="primary" onClick={() => void finishCloudflare(false)} disabled={busy}>
                  {busy ? 'جارٍ التحقق…' : 'حفظ واختبار الاتصال'}
                </Btn>
              </div>
            </div>
            <div className="hr" />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Btn kind="ghost" onClick={() => void verifyAndContinue()}>تخطّي الكل والدخول الآن</Btn>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
