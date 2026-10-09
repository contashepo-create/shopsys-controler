import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { bridge } from '../../data/bridge.ts'
import { hashPassword, validatePasswordStrength } from '../../core/password.ts'
import { OTP_TTL_MS, OTP_MAX_ATTEMPTS } from '../../core/otp.ts'
import { buildOtpSendError } from '../../core/telegramAdmin.ts'
import { APP_NAME } from '../../core/settings.ts'
import { useSessionStore } from '../../stores/session.store.ts'
import { audit } from '../../data/actions.ts'
import { Field, Btn, useToast } from '../components/ui.tsx'

type Mode = 'unlock' | 'forgot' | 'reset'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Lock screen + password recovery.
 *  · unlock  — كلمة مرور اللوحة؛ التحقق في العملية الرئيسية بالملح المخزّن (وليس بتجزئة جديدة)
 *  · forgot  — العملية الرئيسية تولّد رمزاً من 6 أرقام وترسله لمحادثة البوت (الرمز لا يمر بالواجهة)
 *  · reset   — الرمز + كلمة المرور الجديدة
 * تغيير كلمة المرور واللوحة مفتوحة: الإعدادات ← كلمة مرور اللوحة.
 */
export function LockPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { profile, unlock } = useSessionStore()
  const [mode, setMode] = useState<Mode>('unlock')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)

  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null)
  const [code, setCode] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [remaining, setRemaining] = useState(OTP_TTL_MS)

  const [hasBot, setHasBot] = useState(false)

  useEffect(() => {
    void bridge.secrets.status()
      .then((st) => setHasBot(st.hasBotToken && Boolean(st.adminChatId)))
      .catch(() => setHasBot(false))
  }, [])

  useEffect(() => {
    if (otpExpiresAt == null) return
    const tick = () => {
      const left = otpExpiresAt - Date.now()
      setRemaining(Math.max(0, left))
      return left
    }
    tick()
    const t = setInterval(() => { if (tick() <= 0) clearInterval(t) }, 1000)
    return () => clearInterval(t)
  }, [otpExpiresAt])

  async function doUnlock() {
    if (!pw || busy) return
    setBusy(true)
    try {
      const res = await bridge.auth.verifyPassword(pw)
      if (!res.ok) {
        if (res.code === 'cooldown') toast(`محاولات خاطئة كثيرة — انتظر ${Math.ceil((res.retryInMs ?? 30000) / 1000)} ثانية`, 'error')
        else toast('كلمة المرور غير صحيحة', 'error')
        setBusy(false)
        return
      }
      unlock()
      navigate('/dashboard')
    } catch (e) {
      toast(errText(e), 'error')
      setBusy(false)
    }
  }

  async function sendCode() {
    setBusy(true)
    try {
      const status = await bridge.secrets.status()
      if (!status.hasBotToken || !status.adminChatId) {
        toast('ربط البوت غير مكتمل — لا يمكن إرسال رمز الاستعادة', 'error')
        return
      }
      const res = await bridge.auth.requestOtp('استعادة كلمة المرور')
      if (!res.ok) {
        toast(res.code === 'send_failed' ? buildOtpSendError(res.error ?? '') : (res.error ?? 'تعذر إرسال الرمز'), 'error')
        return
      }
      setOtpExpiresAt(res.expiresAt ?? Date.now() + OTP_TTL_MS)
      setCode('')
      setMode('reset')
      toast('تم إرسال رمز التحقق إلى تليجرام ‑ تحقق من محادثة البوت', 'ok')
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function confirmReset() {
    // تُفحص كلمة المرور الجديدة أولاً: كلمة ضعيفة أو غير متطابقة لا تستهلك محاولة من محاولات الرمز
    const err = validatePasswordStrength(newPw)
    if (err) { toast(err, 'error'); return }
    if (newPw !== newPw2) { toast('كلمتا المرور غير متطابقتين', 'error'); return }
    setBusy(true)
    try {
      const res = await bridge.auth.resetWithOtp(code.trim(), await hashPassword(newPw))
      if (!res.ok) {
        toast(res.error ?? 'تعذر تعيين كلمة المرور', 'error')
        if (res.code === 'expired' || res.code === 'locked' || res.code === 'no_otp') { setOtpExpiresAt(null); setMode('forgot') }
        return
      }
      await audit('password_reset', undefined, {}).catch(() => {})
      toast('تم تحديث كلمة المرور ✓ — ادخل بها الآن', 'ok')
      setPw(newPw)
      setNewPw(''); setNewPw2(''); setCode(''); setOtpExpiresAt(null)
      setMode('unlock')
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const minutes = Math.floor(remaining / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)

  return (
    <div className="center-screen">
      <div className="panel-box">
        <div style={{ textAlign: 'center', marginBlockEnd: 18 }}>
          <div style={{ fontWeight: 900, fontSize: 20 }}>🔐 {APP_NAME}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {profile ? `مرحباً ${profile.name}` : 'لوحة إدارة التراخيص والاشتراكات'}
          </div>
        </div>

        {mode === 'unlock' ? (
          <form onSubmit={(e) => { e.preventDefault(); void doUnlock() }}>
            <Field label="كلمة مرور اللوحة" value={pw} onChange={setPw} type="password" />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <Btn kind="ghost" size="sm" onClick={() => setMode('forgot')} disabled={!hasBot}>
                نسيت كلمة المرور؟
              </Btn>
              <Btn kind="primary" onClick={() => void doUnlock()} disabled={busy || !pw}>
                {busy ? 'جارٍ التحقق…' : 'دخول'}
              </Btn>
            </div>
          </form>
        ) : null}

        {mode === 'forgot' ? (
          <>
            <div className="card" style={{ marginBlockEnd: 14, fontSize: 13.5 }}>
              سنرسل رمز تحقق مكوّن من 6 أرقام إلى <b>بوت تليجرام الخاص بك</b> (المحادثة الموثوقة).
              الرمز صالح {Math.round(OTP_TTL_MS / 60000)} دقائق، و{OTP_MAX_ATTEMPTS} محاولات.
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <Btn onClick={() => setMode('unlock')}>رجوع</Btn>
              <Btn kind="primary" onClick={() => void sendCode()} disabled={busy}>
                {busy ? 'جارٍ الإرسال…' : 'إرسال الرمز إلى تليجرام'}
              </Btn>
            </div>
          </>
        ) : null}

        {mode === 'reset' && otpExpiresAt != null ? (
          <>
            <div className="card" style={{ marginBlockEnd: 14, fontSize: 13.5 }}>
              {remaining > 0
                ? <>📨 أُرسل الرمز إلى محادثة البوت — يتبقى {minutes}:{String(seconds).padStart(2, '0')}</>
                : <>⌛ انتهت صلاحية الرمز — أعد الإرسال</>}
            </div>
            <Field label="رمز التحقق (6 أرقام)" value={code} onChange={setCode} dir="ltr" mono />
            <Field label="كلمة المرور الجديدة" value={newPw} onChange={setNewPw} type="password" />
            <Field label="تأكيد كلمة المرور الجديدة" value={newPw2} onChange={setNewPw2} type="password" />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <Btn onClick={() => { setOtpExpiresAt(null); setMode('forgot') }}>إعادة إرسال</Btn>
              <Btn kind="primary" onClick={() => void confirmReset()} disabled={busy || code.trim().length < 6 || !newPw || remaining <= 0}>
                {busy ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور الجديدة'}
              </Btn>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
