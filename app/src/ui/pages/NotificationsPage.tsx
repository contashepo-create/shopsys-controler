import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDataStore } from '../../stores/data.store.ts'
import { deleteNotice, editNotice, listSentNotices, sendNotice } from '../../data/actions.ts'
import {
  customerActivity, describeTargeting, noticeRecipients, summarizeRecipients, validateNoticeBody, READ_STATE_LABELS_AR,
  type NoticeTargeting, type SentNotice, type NoticeReadState,
} from '../../core/notices.ts'
import { Btn, Field, Textarea, useToast, Badge, EmptyState, Modal, ConfirmDialog } from '../components/ui.tsx'
import { activityLabel } from '../../core/activities.ts'

type TargetType = 'all' | 'device' | 'group' | 'activity'

const fmt = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—')
const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400000)) : 0)
const STATE_BADGE: Record<NoticeReadState, 'ok' | 'accent' | 'muted'> = { read: 'ok', delivered: 'accent', pending: 'muted' }

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

  const [sent, setSent] = useState<SentNotice[]>([])
  const [reads, setReads] = useState<Map<string, Record<string, string>>>(new Map())
  const [loadingSent, setLoadingSent] = useState(false)
  const [editing, setEditing] = useState<SentNotice | null>(null)
  const [deleting, setDeleting] = useState<SentNotice | null>(null)
  const [viewing, setViewing] = useState<SentNotice | null>(null)

  const loadSent = useCallback(async () => {
    setLoadingSent(true)
    try {
      const res = await listSentNotices()
      setSent(res.notices)
      setReads(res.readsByDevice)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    setLoadingSent(false)
  }, [toast])

  useEffect(() => { void refresh(); void loadSent() }, [refresh, loadSent])

  const activities = useMemo(() => {
    const set = new Map<string, number>()
    for (const c of customers) {
      const a = customerActivity(c)
      if (a) set.set(a, (set.get(a) ?? 0) + 1)
    }
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
      await loadSent()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    setBusy(false)
  }

  async function doDelete(n: SentNotice) {
    setDeleting(null)
    setBusy(true)
    try {
      await deleteNotice(n)
      toast('🗑️ حُذف الإشعار — يختفي من تطبيق العميل عند أول مزامنة', 'ok')
      // تحديث محلي بدل إعادة قراءة كل القوائم من Cloudflare
      setSent((list) => list.filter((x) => x.notice.id !== n.notice.id))
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  const audience = (n: SentNotice) => (n.scope === 'global' ? 'جميع العملاء' : n.deviceIds.length === 1
    ? (customers.find((c) => c.deviceId === n.deviceIds[0])?.customer || n.deviceIds[0])
    : `${n.deviceIds.length} عميل`)

  const hasAnyReceipts = reads.size > 0

  return (
    <>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-title">🎯 إلى من؟</div>
          <div className="row" style={{ marginBlockEnd: 12 }}>
            <Btn size="sm" kind={targetType === 'all' ? 'primary' : 'default'} onClick={() => setTargetType('all')}>الكل</Btn>
            <Btn size="sm" kind={targetType === 'device' ? 'primary' : 'default'} onClick={() => setTargetType('device')}>عميل واحد</Btn>
            <Btn size="sm" kind={targetType === 'group' ? 'primary' : 'default'} onClick={() => setTargetType('group')}>مجموعة</Btn>
            <Btn size="sm" kind={targetType === 'activity' ? 'primary' : 'default'} onClick={() => setTargetType('activity')}>نشاط معين</Btn>
          </div>

          {targetType === 'device' ? (
            <div className="field">
              <select className="select" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">— اختر عميلاً —</option>
                {customers.map((c) => <option key={c.deviceId} value={c.deviceId}>{c.customer || '—'} ({c.deviceId})</option>)}
              </select>
            </div>
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
                    {activityLabel(id)} ({count})
                  </Btn>
                ))}
              </div>
            )
          ) : null}

          <div className="hr" />
          <span className="muted">سيصل إلى: <b>{preview}</b></span>
        </div>

        <div className="card">
          <div className="card-title">✍️ نص الإشعار</div>
          <Field label="العنوان (اختياري)" value={title} onChange={setTitle} placeholder="رسالة من المطوّر" />
          <Textarea label="النص *" value={body} onChange={setBody} rows={5} placeholder="مثال: تم إصدار تحديث جديد — برجاء إعادة تشغيل البرنامج…" />
          <Field label="مدة العرض (أيام)" value={expiresDays} onChange={setExpiresDays} dir="ltr" hint="يختفي تلقائياً بعدها عند العميل" />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Btn kind="primary" disabled={busy || !body.trim()} onClick={() => void send()}>{busy ? 'جارٍ الإرسال…' : 'إرسال الإشعار'}</Btn>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBlockStart: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBlockEnd: 10 }}>
          <div className="card-title" style={{ margin: 0 }}>📬 الإشعارات المرسلة ({sent.length})</div>
          <Btn size="sm" onClick={() => void loadSent()} disabled={loadingSent}>{loadingSent ? '…' : 'تحديث'}</Btn>
        </div>
        {sent.length === 0 ? (
          <EmptyState icon="🔔" text={loadingSent ? 'جارٍ التحميل…' : 'لا إشعارات مرسلة'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الإشعار</th><th>إلى</th><th>أُرسل</th><th>ينتهي</th><th>القراءة</th><th>إجراءات</th></tr></thead>
              <tbody>
                {sent.map((n) => {
                  const sum = summarizeRecipients(noticeRecipients(n, customers, reads))
                  const expired = n.notice.expiresAt != null && Date.parse(n.notice.expiresAt) < Date.now()
                  return (
                    <tr key={n.notice.id}>
                      <td style={{ maxInlineSize: 360 }}>
                        <div style={{ fontWeight: 700 }}>
                          {n.notice.title} {n.notice.editedAt ? <Badge kind="muted">معدّل</Badge> : null} {expired ? <Badge kind="danger">منتهٍ</Badge> : null}
                        </div>
                        <div className="muted" style={{ fontSize: 12.5 }}>{n.notice.body.length > 110 ? n.notice.body.slice(0, 110) + '…' : n.notice.body}</div>
                      </td>
                      <td>{audience(n)}</td>
                      <td className="muted">{fmt(n.notice.createdAt)}</td>
                      <td className="muted">{fmt(n.notice.expiresAt)}</td>
                      <td>
                        <button type="button" className="btn btn-ghost btn-sm read-bar" onClick={() => setViewing(n)} title="عرض المستلمين">
                          <span style={{ color: 'var(--ok)' }}>✅ {sum.read}</span>
                          <span style={{ color: 'var(--accent)' }}>📥 {sum.delivered}</span>
                          <span className="muted">⏳ {sum.pending}</span>
                        </button>
                      </td>
                      <td>
                        <div className="row">
                          <Btn size="sm" onClick={() => setEditing(n)}>✏️ تعديل</Btn>
                          <Btn size="sm" kind="danger" disabled={busy} onClick={() => setDeleting(n)}>🗑️ حذف</Btn>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="muted" style={{ fontSize: 12, marginBlockStart: 8 }}>
          ✅ قرأه · 📥 وصله (فتح التطبيق بعد الإرسال) · ⏳ لم يصله بعد — اضغط على الأرقام لمعرفة الأسماء.
        </div>
      </div>

      {editing ? (
        <EditNoticeDialog
          notice={editing}
          onClose={() => setEditing(null)}
          onSaved={(patch) => {
            const id = editing.notice.id
            setSent((list) => list.map((x) => (x.notice.id === id ? { ...x, notice: { ...x.notice, ...patch, editedAt: new Date().toISOString() } } : x)))
            setEditing(null)
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting != null}
        title="حذف الإشعار"
        message={`سيُحذف «${deleting?.notice.title ?? ''}» من ${deleting ? audience(deleting) : ''} ويختفي من تطبيقاتهم عند أول مزامنة.`}
        confirmText="🗑️ حذف"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => { if (deleting) void doDelete(deleting) }}
      />

      <Modal open={viewing != null} wide title={`من قرأ «${viewing?.notice.title ?? ''}»؟`} sub={viewing ? `أُرسل ${fmt(viewing.notice.createdAt)} إلى ${audience(viewing)}` : ''} onClose={() => setViewing(null)}>
        {viewing ? (
          <>
            {!hasAnyReceipts ? (
              <div className="notice notice-warn" style={{ display: 'block', marginBlockEnd: 10 }}>
                لم يصل أي إيصال قراءة بعد. «قرأه» يظهر عندما يبلّغ تطبيق العميل عن فتح الإشعار
                (التفاصيل في <span className="mono">docs/تتبع-قراءة-الإشعارات.md</span>)، وحتى ذلك الحين تعرض اللوحة «وصله» من آخر ظهور للتطبيق.
              </div>
            ) : null}
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>العميل</th><th>الحالة</th><th>الوقت</th></tr></thead>
                <tbody>
                  {noticeRecipients(viewing, customers, reads)
                    .sort((a, b) => ['read', 'delivered', 'pending'].indexOf(a.state) - ['read', 'delivered', 'pending'].indexOf(b.state))
                    .map((r) => (
                      <tr key={r.deviceId}>
                        <td><div style={{ fontWeight: 700 }}>{r.customer || '—'}</div><div className="mono muted" style={{ fontSize: 11.5 }}>{r.deviceId}</div></td>
                        <td><Badge kind={STATE_BADGE[r.state]}>{READ_STATE_LABELS_AR[r.state]}</Badge></td>
                        <td className="muted">{r.state === 'pending' ? (r.at ? `آخر ظهور ${fmt(r.at)}` : '—') : fmt(r.at)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </Modal>
    </>
  )
}

function EditNoticeDialog(props: { notice: SentNotice; onClose: () => void; onSaved: (patch: { title: string; body: string; expiresAt?: string }) => void }) {
  const toast = useToast()
  const n = props.notice.notice
  const [title, setTitle] = useState(n.title)
  const [body, setBody] = useState(n.body)
  const initialDays = String(daysLeft(n.expiresAt) || 30)
  const [days, setDays] = useState(initialDays)
  const [busy, setBusy] = useState(false)

  async function save() {
    const err = validateNoticeBody(body)
    if (err) { toast(err, 'error'); return }
    setBusy(true)
    try {
      // المدة لم تُلمس (والإشعار غير منتهٍ) → يبقى تاريخ الانتهاء الأصلي كما هو بالضبط
      const keepExpiry = days.trim() === initialDays && daysLeft(n.expiresAt) > 0
      const patch: { title: string; body: string; expiresAt?: string } = {
        title: title.trim() || 'رسالة من المطوّر', body,
        ...(keepExpiry ? {} : { expiresAt: new Date(Date.now() + (Number(days) || 30) * 86400000).toISOString() }),
      }
      await editNotice(props.notice, patch)
      toast('✏️ عُدِّل الإشعار — يظهر النص الجديد عند العميل في أول مزامنة', 'ok')
      props.onSaved(patch)
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  return (
    <Modal open wide title="تعديل الإشعار" sub={`أُرسل ${fmt(n.createdAt)}`} onClose={props.onClose}
      actions={<><Btn onClick={props.onClose}>إلغاء</Btn><Btn kind="primary" disabled={busy || !body.trim()} onClick={() => void save()}>{busy ? '…' : 'حفظ التعديل'}</Btn></>}>
      <Field label="العنوان" value={title} onChange={setTitle} />
      <Textarea label="النص" value={body} onChange={setBody} rows={6} />
      <Field label="يبقى ظاهراً (أيام من الآن)" value={days} onChange={setDays} dir="ltr" hint={daysLeft(n.expiresAt) ? `المتبقي حالياً: ${daysLeft(n.expiresAt)} يوم` : 'منتهٍ — حدّد مدة لإعادة إظهاره'} />
    </Modal>
  )
}
