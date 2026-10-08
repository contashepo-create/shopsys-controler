import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { bridge } from '../../data/bridge.ts'
import { hashPassword, verifyPassword, validatePasswordStrength } from '../../core/password.ts'
import {
  generateOtpCode, hashOtp, createPendingOtp, checkOtp, buildOtpMessage, OTP_TTL_MS,
  type PendingOtp,
} from '../../core/otp.ts'
import { buildOtpSendError } from '../../core/telegramAdmin.ts'
import { APP_NAME } from '../../core/settings.ts'
import { useSessionStore } from '../../stores/session.store.ts'
import { audit } from '../../data/actions.ts'
import { Field, Btn, useToast } from '../components/ui.tsx'

type Mode = 'unlock' | 'forgot' | 'reset' | 'change'

/**
 * Lock screen + password flows.
 *  · unlock  — enter the panel password
 *  · forgot  — send a 6-digit code to the developer's Telegram chat (the trusted channel)
 *  · reset   — code + new password (the "when I forget the password" flow the user asked for)
 *  · change  — same OTP gate, used from Settings while unlocked
 */
export function LockPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { profile, unlock } = useSessionStore()
  const [mode, setMode] = useState<Mode>('unlock')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)

  const [otp, setOtp] = useState<PendingOtp | null>(null)
  const [code, setCode] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [remaining, setRemaining] = useState(OTP_TTL_MS)

  const [hasBot, setHasBot] = useState(false)

  useEffect(() => {
    void bridge.secrets.status().then((st) => setHasBot(st.hasBotToken && Boolean(st.adminChatId)))
  }, [])

  useEffect(() => {
    if (!otp) return
    const t = setInterval(() => {
      const left = otp.expiresAt - Date.now()
      setRemaining(Math.max(0, left))
      if (left <= 0) clearInterval(t)
    }, 1000)
    return () => clearInterval(t)
  }, [otp])

  async function doUnlock() {
    if (!pw) return
    setBusy(true)
    try {
      const h = await hashPassword(pw)
      const ok = await bridge.auth.verifyPassword(h)
      if (!ok) { toast('كلمة المرور غير صحيحة', 'error'); setBusy(false); return }
      unlock()
      navigate('/dashboard')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      setBusy(false)
    }
  }

  async function sendCode() {
    setBusy(true)
    try {
      const status = await bridge.secrets.status()
      if (!status.hasBotToken || !status.adminChatId) {
        toast('ربط البوت غير مكتمل — لا يمكن إرسال رمز الاستعادة', 'error')
        setBusy(false)
        return
      }
      const c = generateOtpCode()
      const h = await hashOtp(c)
      const res = await bridge.tg.send(buildOtpMessage(APP_NAME, c, mode === 'forgot' ? 'استعادة كلمة المرور' : 'تغيير كلمة المرور'))
      if (!res.ok) { toast(buildOtpSendError(res.error ?? ''), 'error'); setBusy(false); return }
      setOtp(createPendingOtp(h))
      setRemaining(OTP_TTL_MS)
      setCode('')
      setMode(mode === 'forgot' ? 'reset' : 'change')
      toast('تم إرسال رمز التحقق إلى تليجرام ‑ تحقق من محادثة البوت', 'ok')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    setBusy(false)
  }

  async function confirmReset() {
    if (!otp) return
    setBusy(true)
    try {
      const verdict = await checkOtp(otp, code)
      if (verdict === 'expired') { toast('انتهت صلاحية الرمز — أعد الإرسال', 'error'); setBusy(false); setMode('forgot'); return }
      if (verdict === 'locked') { toast('محاولات كثيرة خاطئة — أعد الإرسال', 'error'); setBusy(false); setMode('forgot'); return }
      if (verdict !== 'ok') { setOtp({ ...otp }); toast(`رمز خاطئ — تبقى ${3 - otp.attempts} محاولات`, 'error'); setBusy(false); return }
      const err = validatePasswordStrength(newPw)
      if (err) { toast(err, 'error'); setBusy(false); return }
      if (newPw !== newPw2) { toast('كلمتا المرور غير متطابقتين', 'error'); setBusy(false); return }
      const h = await hashPassword(newPw)
      await bridge.auth.setPassword(h)
      await audit(mode === 'change' ? 'password_change' : 'password_reset', undefined, {})
      toast('تم تحديث كلمة المرور ✓', 'ok')
      setPw(newPw)
      setNewPw(''); setNewPw2(''); setCode(''); setOtp(null)
      setMode('unlock')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    setBusy(false)
  }

  // "change" mode while unlocked: this screen is also mounted from Settings without locking
  async function doChangeWhileUnlocked() {
    setBusy(true)
    try {
      const h = await hashPassword(pw)
      const ok = await bridge.auth.verifyPassword(h)
      if (!ok) { toast('كلمة المرور الحالية غير صحيحة', 'error'); setBusy(false); return }
      await sendCode()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
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
          <>
            <Field label="كلمة مرور اللوحة" value={pw} onChange={setPw} type="password" />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <Btn kind="ghost" size="sm" onClick={() => setMode(hasBot ? 'forgot' : 'unlock')} disabled={!hasBot}>
                نسيت كلمة المرور؟
              </Btn>
              <Btn kind="primary" onClick={() => void doUnlock()} disabled={busy || !pw}>
                {busy ? 'جارٍ التحقق…' : 'دخول'}
              </Btn>
            </div>
          </>
        ) : null}

        {mode === 'forgot' ? (
          <>
            <div className="card" style={{ marginBlockEnd: 14, fontSize: 13.5 }}>
              سنرسل رمز تحقق مكوّن من 6 أرقام إلى <b>بوت تليجرام الخاص بك</b> (المحادثة الموثوقة).
              الرمز صالح {Math.round(OTP_TTL_MS / 60000)} دقائق.
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <Btn onClick={() => setMode('unlock')}>رجوع</Btn>
              <Btn kind="primary" onClick={() => void sendCode()} disabled={busy}>
                {busy ? 'جارٍ الإرسال…' : 'إرسال الرمز إلى تليجرام'}
              </Btn>
            </div>
          </>
        ) : null}

        {(mode === 'reset' || mode === 'change') && otp ? (
          <>
            <div className="card" style={{ marginBlockEnd: 14, fontSize: 13.5 }}>
              📨 أُرسل الرمز إلى محادثة البوت — يتبقى {minutes}:{String(seconds).padStart(2, '0')}
            </div>
            <Field label="رمز التحقق (6 أرقام)" value={code} onChange={setCode} dir="ltr" mono />
            <Field label="كلمة المرور الجديدة" value={newPw} onChange={setNewPw} type="password" />
            <Field label="تأكيد كلمة المرور الجديدة" value={newPw2} onChange={setNewPw2} type="password" />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <Btn onClick={() => { setOtp(null); setMode('forgot') }}>إعادة إرسال</Btn>
              <Btn kind="primary" onClick={() => void confirmReset()} disabled={busy || code.length < 6 || !newPw}>
                {busy ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور الجديدة'}
              </Btn>
            </div>
          </>
        ) : null}
      </div>

      {/* hidden helper used from Settings: change with current password */}
      {mode === 'change' && !otp ? (
        <div className="panel-box" style={{ marginBlockStart: 12 }}>
          <Field label="كلمة المرور الحالية" value={pw} onChange={setPw} type="password" />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Btn kind="primary" onClick={() => void doChangeWhileUnlocked()} disabled={busy}>إرسال رمز التغيير</Btn>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Re-exported so Settings can trigger the same OTP change flow inline. */
export { verifyPassword }
