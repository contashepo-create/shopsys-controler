import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDataStore } from '../../stores/data.store.ts'
import { readSupportChat, replySupport } from '../../data/actions.ts'
import type { ChatMessage } from '../../core/support.ts'
import { Btn, EmptyState, Textarea, useToast, Badge } from '../components/ui.tsx'

interface Ticket {
  deviceId: string
  customer: string
  lastSupportAt: string | null
  unread: boolean
  /** محادثة بلا سجل جهاز (لم يُفعَّل التطبيق بعد) */
  chatOnly: boolean
}

const fmtAt = (at: unknown) => String(at ?? '').slice(0, 16).replace('T', ' ')

export function SupportPage() {
  const toast = useToast()
  const { customers, chatOnly, refresh, servicesAvailable, servicesError } = useDataStore()
  const [selectedId, setSelectedId] = useState('')
  const [chat, setChat] = useState<ChatMessage[]>([])
  /** أجهزة رُدّ عليها في هذه الجلسة — تُزال علامة «جديد» فوراً قبل التحديث التالي */
  const [answered, setAnswered] = useState<Record<string, boolean>>({})
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  /** رقم آخر طلب قراءة — ردّ بطيء لتذكرة سابقة لا يُعرض تحت التذكرة المختارة الآن */
  const requestSeq = useRef(0)

  useEffect(() => { void refresh() }, [refresh])

  // علامة «جديد» تأتي من التحديث نفسه (آخر رسالة من العميل) لكل التذاكر — بدل فحص متسلسل
  // كان يقرأ أول 60 عميلاً فقط (لا التذاكر) فيفوّت رسائل جديدة لبقية العملاء
  const tickets = useMemo<Ticket[]>(() => {
    const list: Ticket[] = customers
      .filter((c) => c.lastSupportAt || c.supportUnread)
      .map((c) => ({ deviceId: c.deviceId, customer: c.customer, lastSupportAt: c.lastSupportAt, unread: c.supportUnread, chatOnly: false }))
    for (const d of chatOnly) list.push({ deviceId: d.deviceId, customer: '', lastSupportAt: d.lastSupportAt, unread: d.supportUnread, chatOnly: true })
    return list.sort((a, b) => (b.lastSupportAt ?? '').localeCompare(a.lastSupportAt ?? ''))
  }, [customers, chatOnly])

  // التحديث التالي يحمل الحالة الحقيقية من السحابة — نُسقط التجاوز المحلي
  useEffect(() => { setAnswered({}) }, [customers, chatOnly])

  const selected = tickets.find((t) => t.deviceId === selectedId)

  async function openTicket(deviceId: string) {
    const seq = ++requestSeq.current
    setSelectedId(deviceId)
    setChat([])
    setBusy(true)
    try {
      const msgs = await readSupportChat(deviceId)
      if (seq === requestSeq.current) setChat(msgs)
    } catch (e) {
      if (seq === requestSeq.current) toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      if (seq === requestSeq.current) setBusy(false)
    }
  }

  async function sendReply() {
    if (!selectedId || !reply.trim()) return
    const deviceId = selectedId
    const seq = ++requestSeq.current
    setBusy(true)
    try {
      await replySupport(deviceId, reply)
      setAnswered((m) => ({ ...m, [deviceId]: true }))
      toast('تم إرسال الرد — سيظهر للعميل عند فتحه صفحة الدعم', 'ok')
      if (seq === requestSeq.current) {
        setReply('')
        const msgs = await readSupportChat(deviceId)
        if (seq === requestSeq.current) setChat(msgs)
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      if (seq === requestSeq.current) setBusy(false)
    }
  }

  if (!servicesAvailable) {
    return (
      <div className="card">
        <div className="card-title">🎧 قناة الدعم — تحتاج ضبط مساحة الخدمات</div>
        <p style={{ marginBlockStart: 0 }}>
          محادثات الدعم تُحفظ في مساحة <span className="mono">SHOPSYS_KV</span> التي يقرأ منها تطبيق العميل
          (المسار <span className="mono">/support/&lt;deviceId&gt;</span> على خدمة تَحَكَّم السحابية).
          هذه المساحة <b>غير مضبوطة بعد</b>، لذلك لا يمكن قراءة التذاكر أو الرد عليها.
        </p>
        {servicesError ? <div className="notice notice-warn" style={{ display: 'block' }}>{servicesError}</div> : null}
        <ol className="plain" style={{ fontSize: 13.5 }}>
          <li>الإعدادات ← Cloudflare ← <b>اكتشف من الحساب</b>: لو المساحة موجودة سيملؤها تلقائياً.</li>
          <li>لو لم توجد: اضغط <b>➕ إنشاء المساحة</b> في نفس الصفحة (اسمها <span className="mono">SHOPSYS_KV</span>).</li>
          <li>أعطِ اللوحة معرّفها، ثم اربطها بخدمة تَحَكَّم السحابية وأعد النشر (التعليمات تظهر لحظة الإنشاء).</li>
        </ol>
        <div className="row"><Link className="btn btn-primary" to="/settings">فتح الإعدادات</Link></div>
      </div>
    )
  }

  return (
    <div className="grid-2" style={{ alignItems: 'start', gridTemplateColumns: '320px 1fr' }}>
      <div className="card" style={{ padding: 10 }}>
        <div className="card-title" style={{ paddingInlineStart: 6 }}>🎧 تذاكر الدعم</div>
        {tickets.length === 0 ? <EmptyState icon="🎧" text="لا تذاكر دعم بعد" hint="تظهر هنا عندما يرسل العميل بلاغاً من داخل التطبيق" /> : tickets.map((c) => (
          <button
            key={c.deviceId}
            className={`nav-item${selectedId === c.deviceId ? ' active' : ''}`}
            style={{ inlineSize: '100%', justifyContent: 'space-between', background: 'none' }}
            onClick={() => void openTicket(c.deviceId)}
          >
            <span style={{ textAlign: 'start' }}>
              <span style={{ display: 'block', fontWeight: 700 }}>{c.customer || c.deviceId}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {fmtAt(c.lastSupportAt)}{c.chatOnly ? ' · لم يُفعَّل بعد' : ''}
              </span>
            </span>
            {c.unread && !answered[c.deviceId] ? <Badge kind="warn">جديد</Badge> : null}
          </button>
        ))}
      </div>

      <div className="card">
        {!selectedId ? (
          <EmptyState icon="💬" text="اختر تذكرة لقراءة المحادثة" hint="ردودك تُكتب في نفس محادثة العميل داخل التطبيق" />
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'space-between', marginBlockEnd: 12 }}>
              <div>
                <b>{selected?.customer || (selected?.chatOnly ? 'جهاز لم يُفعَّل بعد' : 'العميل')}</b>
                <div className="mono muted">{selectedId}</div>
              </div>
              <Btn size="sm" onClick={() => void openTicket(selectedId)} disabled={busy}>تحديث المحادثة</Btn>
            </div>
            <div style={{ maxBlockSize: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBlockEnd: 12 }}>
              {chat.length === 0 ? <span className="muted">لا رسائل بعد</span> : chat.map((m) => (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.from === 'developer' ? 'flex-start' : 'flex-end',
                    background: m.from === 'developer' ? 'rgba(45,212,191,0.12)' : 'var(--panel-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: '8px 12px',
                    maxInlineSize: '75%',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 800, color: m.from === 'developer' ? 'var(--accent)' : 'var(--accent-2)' }}>
                    {m.from === 'developer' ? 'المطوّر' : 'العميل'}
                  </div>
                  <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{m.text}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{fmtAt(m.at)}</div>
                </div>
              ))}
            </div>
            <Textarea label="ردّك" value={reply} onChange={setReply} rows={3} placeholder="اكتب ردك للعميل…" />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Btn kind="primary" disabled={busy || !reply.trim()} onClick={() => void sendReply()}>{busy ? '…' : 'إرسال الرد'}</Btn>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
