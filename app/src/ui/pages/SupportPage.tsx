import { useEffect, useMemo, useState } from 'react'
import { bridge } from '../../data/bridge.ts'
import { useDataStore } from '../../stores/data.store.ts'
import { readSupportChat, replySupport } from '../../data/actions.ts'
import { hasUnreadFromClient, type ChatMessage } from '../../core/support.ts'
import { Btn, EmptyState, Textarea, useToast, Badge } from '../components/ui.tsx'

export function SupportPage() {
  const toast = useToast()
  const { customers, refresh } = useDataStore()
  const [selectedId, setSelectedId] = useState('')
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [unread, setUnread] = useState<Record<string, boolean>>({})
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { void refresh() }, [refresh])

  // scan a sample of conversations to show unread markers
  useEffect(() => {
    let cancelled = false
    async function scan() {
      const marks: Record<string, boolean> = {}
      for (const c of customers.slice(0, 60)) {
        const r = await bridge.cf.get('services', `chat:${c.deviceId}`)
        if (cancelled) return
        if (r.ok && r.value) {
          try {
            const arr = JSON.parse(r.value) as ChatMessage[]
            if (Array.isArray(arr)) marks[c.deviceId] = hasUnreadFromClient(arr)
          } catch { /* ignore */ }
        }
      }
      if (!cancelled) setUnread(marks)
    }
    if (customers.length) void scan()
    return () => { cancelled = true }
  }, [customers])

  const tickets = useMemo(
    () => customers.filter((c) => c.lastSupportAt).sort((a, b) => (b.lastSupportAt ?? '').localeCompare(a.lastSupportAt ?? '')),
    [customers],
  )

  async function openTicket(deviceId: string) {
    setSelectedId(deviceId)
    setBusy(true)
    try {
      setChat(await readSupportChat(deviceId))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    setBusy(false)
  }

  async function sendReply() {
    if (!selectedId || !reply.trim()) return
    setBusy(true)
    try {
      await replySupport(selectedId, reply)
      setReply('')
      setChat(await readSupportChat(selectedId))
      toast('تم إرسال الرد — سيظهر للعميل عند فتحه صفحة الدعم', 'ok')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    setBusy(false)
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
              <span className="muted" style={{ fontSize: 12 }}>{(c.lastSupportAt ?? '').slice(0, 16).replace('T', ' ')}</span>
            </span>
            {unread[c.deviceId] ? <Badge kind="warn">جديد</Badge> : null}
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
                <b>{customers.find((c) => c.deviceId === selectedId)?.customer || 'العميل'}</b>
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
                  <div className="muted" style={{ fontSize: 11 }}>{m.at.slice(0, 16).replace('T', ' ')}</div>
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
