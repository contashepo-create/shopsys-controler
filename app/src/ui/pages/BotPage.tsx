import { useState } from 'react'
import { bridge } from '../../data/bridge.ts'
import { useConfigStore } from '../../stores/config.store.ts'
import { maskToken, isValidBotToken, isValidChatId, buildTestMessage } from '../../core/telegramAdmin.ts'
import { APP_NAME } from '../../core/settings.ts'
import { Btn, Field, useToast, Badge } from '../components/ui.tsx'

/**
 * Bot link & monitoring.
 *  · The SAME developer bot keeps working — the panel never disables it.
 *  · The bot token + admin chat id power the OTP channel (password reset/change).
 *  · Recently issued keys for the active admin chat live in the bot's message history.
 */
export function BotPage() {
  const toast = useToast()
  const { hasBotToken, botUsername, adminChatId, refreshBot, saveSecrets } = useConfigStore()
  const [token, setToken] = useState('')
  const [chatId, setChatId] = useState(adminChatId)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (token && !isValidBotToken(token)) { toast('صيغة توكن البوت غير صحيحة (123456:ABC…)', 'error'); return }
    if (chatId && !isValidChatId(chatId)) { toast('معرّف المحادثة يجب أن يكون رقماً', 'error'); return }
    setBusy(true)
    try {
      await saveSecrets({ ...(token ? { botToken: token } : {}), adminChatId: chatId })
      await refreshBot()
      toast('تم حفظ إعدادات البوت ✓', 'ok')
      setToken('')
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  async function test() {
    setBusy(true)
    try {
      const me = await bridge.tg.getMe()
      if (!me.ok) { toast(me.error ?? 'التوكن غير صالح', 'error'); setBusy(false); return }
      const res = await bridge.tg.send(buildTestMessage(APP_NAME))
      toast(res.ok ? `✅ يعمل — @${me.username ?? me.firstName ?? ''} أرسل رسالة الاختبار` : `تعذر الإرسال: ${res.error ?? ''}`, res.ok ? 'ok' : 'error')
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  async function findChatId() {
    setBusy(true)
    try {
      const res = await bridge.tg.send('🔎 اختبار معرفة معرّف المحادثة — إذا وصلتك هذه الرسالة فالمعرّف صحيح')
      toast(res.ok ? 'وصلت الرسالة — المعرّف صحيح ✓' : `تعذر: ${res.error ?? ''}`, res.ok ? 'ok' : 'error')
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="card">
        <div className="card-title">🤖 ربط بوت المطوّر (نفس بوت التراخيص)</div>
        <div className="row" style={{ marginBlockEnd: 12 }}>
          {hasBotToken ? <Badge kind="ok">متصل {botUsername ? `@${botUsername}` : ''}</Badge> : <Badge kind="warn">غير مضبوط</Badge>}
          <span className="muted" style={{ fontSize: 12.5 }}>البوت يكمل عمله الطبيعي — اللوحة لا تطفئه ولا تستبدله</span>
        </div>
        <Field label="توكن البوت" value={token} onChange={setToken} type="password" mono hint={hasBotToken ? `محفوظ حالياً: ${maskToken('1234567890:' + 'x'.repeat(30))} — اكتب توكن جديداً للتغيير` : 'من BotFather'} />
        <Field label="معرّف محادثة المطوّر (Admin Chat ID)" value={chatId} onChange={setChatId} mono hint="الرقم الذي يظهر للأوامر الإدارية ولإرسال رموز التحقق" />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Btn onClick={() => void findChatId()} disabled={busy}>اختبار إرسال</Btn>
          <div className="row">
            <Btn onClick={() => void test()} disabled={busy}>فحص البوت</Btn>
            <Btn kind="primary" onClick={() => void save()} disabled={busy || (!token && chatId === adminChatId)}>حفظ</Btn>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">📜 كيف يتكامل البوت مع اللوحة؟</div>
        <ul className="plain" style={{ fontSize: 13.5 }}>
          <li>نفس الـ KV ونفس التنسيقات — كل ما يصدره البوت يظهر فوراً في اللوحة والعكس.</li>
          <li>أوامر البوت (<span className="mono">/اصدر /تجديد /حرق /بحث /رسالة /اشتراكات /سجل</span>) تبقى تعمل كما هي.</li>
          <li>اللوحة تعرض <span className="mono">log:&lt;deviceId&gt;</span> لكل عميل — نفس سجل البوت بالحرف.</li>
          <li>رموز OTP لتغيير/استعادة كلمة مرور اللوحة تُرسل إلى محادثة المطوّر عبر هذا البوت.</li>
          <li>المفتاح الخاص للتوقيع لا يُرفع إلى Cloudflare أبداً — التوقيع يتم على جهازك.</li>
        </ul>
        <div className="hr" />
        <div className="muted" style={{ fontSize: 12.5 }}>
          ⚠️ بعد أي عملية يقوم بها البوت، اضغط «تحديث» في الشريط الأعلى لعرض أحدث البيانات.
        </div>
      </div>
    </div>
  )
}
