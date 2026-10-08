import { useEffect, useMemo, useState } from 'react'
import { bridge } from '../../data/bridge.ts'
import { useDataStore } from '../../stores/data.store.ts'
import { sendNotice } from '../../data/actions.ts'
import { parseNoticeList, describeTargeting, validateNoticeBody, type NoticeTargeting, type CloudNotice } from '../../core/notices.ts'
import { Btn, Field, Textarea, useToast, Badge, EmptyState, Modal } from '../components/ui.tsx'

type TargetType = 'all' | 'device' | 'group' | 'activity'

export function NotificationsPage() {
  const toast = useToast()
  const { customers, refresh } = useDataStore()
  const [targetType, setTargetType] = useState<TargetType>('all')
  const [deviceId, setDeviceId] = useState('')
  const [group, setGroup] = useState<string[]>([])
  const [activity, setActivity] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [expiresDays, setExpiresDays] = useState('90')
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<CloudNotice[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => { void refresh() }, [refresh])

  const activities = useMemo(() => {
    const set = new Map<string, number>()
    for (const c of customers) if (c.activityId) set.set(c.activityId, (set.get(c.activityId) ?? 0) + 1)
    return [...set.entries()].sort((a, b) => b[1] - a[1])
  }, [customers])

  const targeting: NoticeTargeting = useMemo(() => {
    switch (targetType) {
      case 'all': return { type: 'all' }
      case 'device': return { type: 'device', deviceId }
      case 'group': return { type: 'group', deviceIds: group }
      case 'activity': return { type: 'activity', activityId: activity }
    }
  }, [targetType, deviceId, group, activity])

  const preview = useMemo(() => describeTargeting(targeting, customers), [targeting, customers])
  const affected = useMemo(() => {
    if (targetType === 'all') return customers.length
    if (targetType === 'device') return deviceId ? 1 : 0
    if (targetType === 'group') return group.length
    return customers.filter((c) => c.activityId === activity).length
  }, [targetType, deviceId, group, activity, customers])

  async function loadHistory() {
    const [globalRaw, ...rest] = await Promise.all([
      bridge.cf.get('license', 'notices:global'),
    ])
    let list = parseNoticeList(globalRaw.ok ? globalRaw.value : null)
    // sample a few per-device lists for recent history
    for (const c of customers.slice(0, 30)) {
      const r = await bridge.cf.get(`license`, `notices:${c.deviceId}`)
      if (r.ok && r.value) list = [...list, ...parseNoticeList(r.value)]
    }
    void rest
    const unique = new Map<string, CloudNotice>()
    for (const n of list) unique.set(n.id, n)
    setHistory([...unique.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60))
    setHistoryOpen(true)
  }

  async function send() {
    const err = validateNoticeBody(body)
    if (err) { toast(err, 'error'); return }
    if (targetType === 'device' && !deviceId) { toast('اختر عميلاً', 'error'); return }
    if (targetType === 'group' && group.length === 0) { toast('اختر عميلاً واحداً على الأقل', 'error'); return }
    if (targetType === 'activity' && !activity) { toast('اختر نشاطاً', 'error'); return }
    setBusy(true)
    try {
      const days = Number(expiresDays) || 90
      const res = await sendNotice({
        title: title.trim() || undefined,
        body,
        expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
        targeting,
        customers,
      })
      toast(`✅ تم الإرسال — ${preview} (${res.targets} جهاز)`, 'ok')
      setBody(''); setTitle('')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    setBusy(false)
  }

  return (
    <>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-title">🎯 استهداف الإشعار</div>
          <div className="row" style={{ marginBlockEnd: 12 }}>
            <Btn size="sm" kind={targetType === 'all' ? 'primary' : 'default'} onClick={() => setTargetType('all')}>الكل</Btn>
            <Btn size="sm" kind={targetType === 'device' ? 'primary' : 'default'} onClick={() => setTargetType('device')}>عميل واحد</Btn>
            <Btn size="sm" kind={targetType === 'group' ? 'primary' : 'default'} onClick={() => setTargetType('group')}>مجموعة</Btn>
            <Btn size="sm" kind={targetType === 'activity' ? 'primary' : 'default'} onClick={() => setTargetType('activity')}>نشاط معين</Btn>
          </div>

          {targetType === 'device' ? (
            <SelectCustom
              value={deviceId}
              onChange={setDeviceId}
              options={customers.map((c) => ({ value: c.deviceId, label: `${c.customer || '—'} (${c.deviceId})` }))}
              placeholder="— اختر عميلاً —"
            />
          ) : null}

          {targetType === 'group' ? (
            <div style={{ maxBlockSize: 260, overflowY: 'auto', marginBlockEnd: 10 }}>
              {customers.length === 0 ? <span className="muted">لا عملاء</span> : customers.map((c) => (
                <label key={c.deviceId} className="check-row">
                  <input
                    type="checkbox"
                    checked={group.includes(c.deviceId)}
                    onChange={() => setGroup(group.includes(c.deviceId) ? group.filter((x) => x !== c.deviceId) : [...group, c.deviceId])}
                  />
                  <span>{c.customer || '—'}<span className="check-desc"> — {c.deviceId}</span></span>
                </label>
              ))}
            </div>
          ) : null}

          {targetType === 'activity' ? (
            activities.length === 0 ? <span className="muted">لا يوجد عملاء مرتبطون بأنشطة</span> : (
              <div className="row">
                {activities.map(([id, count]) => (
                  <Btn key={id} size="sm" kind={activity === id ? 'primary' : 'default'} onClick={() => setActivity(id)}>
                    {id} ({count})
                  </Btn>
                ))}
              </div>
            )
          ) : null}

          <div className="hr" />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">سيصل إلى: <b>{preview}</b></span>
            <Badge kind="accent">{affected} جهاز</Badge>
          </div>
          <div className="hr" />
          <Btn onClick={() => void loadHistory()}>🕘 سجل الإشعارات المرسلة</Btn>
        </div>

        <div className="card">
          <div className="card-title">✍️ نص الإشعار</div>
          <Field label="العنوان (اختياري)" value={title} onChange={setTitle} placeholder="رسالة من المطوّر" />
          <Textarea label="النص *" value={body} onChange={setBody} rows={6} placeholder="مثال: تم إصدار تحديث جديد — برجاء إعادة تشغيل البرنامج…" />
          <Field label="مدة العرض (أيام)" value={expiresDays} onChange={setExpiresDays} dir="ltr" hint="يختفي تلقائياً بعدها عند العميل" />
          <div className="muted" style={{ fontSize: 12.5, marginBlockEnd: 10 }}>
            يُكتب في <span className="mono">notices:global</span> للجميع، أو <span className="mono">notices:&lt;deviceId&gt;</span> لكل جهاز —
            والتطبيق يدمج القائمتين كما يفعل البوت.
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Btn kind="primary" disabled={busy || !body.trim()} onClick={() => void send()}>{busy ? 'جارٍ الإرسال…' : 'إرسال الإشعار'}</Btn>
          </div>
        </div>
      </div>

      <Modal open={historyOpen} wide title="سجل الإشعارات المرسلة" sub="آخر 60 إشعاراً من القسم العام وعينات الأجهزة" onClose={() => setHistoryOpen(false)}>
        {history.length === 0 ? <EmptyState icon="🔔" text="لا إشعارات مرسلة بعد" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>العنوان</th><th>النص</th><th>أُرسل</th><th>ينتهي</th></tr></thead>
              <tbody>
                {history.map((n) => (
                  <tr key={n.id}>
                    <td>{n.title}</td>
                    <td style={{ maxInlineSize: 380 }}>{n.body.length > 120 ? n.body.slice(0, 120) + '…' : n.body}</td>
                    <td className="muted">{n.createdAt.slice(0, 16).replace('T', ' ')}</td>
                    <td className="muted">{(n.expiresAt ?? '').slice(0, 10) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </>
  )
}

function SelectCustom(props: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder: string }) {
  return (
    <div className="field">
      <select className="select" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">{props.placeholder}</option>
        {props.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

export const Select = SelectCustom
