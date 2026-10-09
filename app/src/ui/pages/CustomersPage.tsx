import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useDataStore } from '../../stores/data.store.ts'
import { deactivateCustomer } from '../../data/customerActions.ts'
import { readCloudFlags, sendKeyToCustomer, setCloudFlag } from '../../data/actions.ts'
import { filterCustomers, isValidPlan, sortCustomers, STATUS_LABELS_AR, type CustomerStatus, type CustomerView, type CustomerSortKey } from '../../core/customers.ts'
import { PLAN_LABELS_AR, FEATURE_LABELS_AR, MODULE_LABELS_AR, LICENSE_FEATURES, type LicensePlan, type LicenseFeature } from '../../core/license.ts'
import { activityDisplay, activityLabel, modulesIncludedInActivity, resolveClientActivity } from '../../core/activities.ts'
import { totalBranches, totalUsers } from '../../core/issueForm.ts'
import { Btn, Modal, useToast, EmptyState, Badge, ConfirmDialog } from '../components/ui.tsx'
import { StatusBadge } from './DashboardPage.tsx'
import { IssueForm, ActivationExplainer } from '../components/IssueForm.tsx'

const STATUS_OPTIONS: { value: CustomerStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'كل الحالات' },
  { value: 'active', label: 'نشط' },
  { value: 'expiring', label: 'قرب الانتهاء' },
  { value: 'expired', label: 'منتهٍ' },
  { value: 'revoked', label: 'معطّل (محروق)' },
  { value: 'none', label: 'بدون اشتراك' },
]

const needsActivation = (c: CustomerView) => c.status === 'revoked' || c.status === 'expired' || c.status === 'none'
const fmtTime = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—')

export function CustomersPage() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const { customers, refresh, loading } = useDataStore()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<CustomerStatus | 'all'>('all')
  const [sortKey, setSortKey] = useState<CustomerSortKey>('customer')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [issueOpen, setIssueOpen] = useState(false)
  /** فُتح الإصدار من زر الصف مباشرة؟ عندها الإغلاق يعيدك للقائمة لا لبطاقة العميل */
  const [issueFromRow, setIssueFromRow] = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState<CustomerView | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { void refresh() }, [refresh])

  // فتح بطاقة العميل مباشرة عند القدوم من لوحة التحكم (?focus=<deviceId>)
  const focusDevice = params.get('focus')
  useEffect(() => {
    if (focusDevice && customers.some((c) => c.deviceId === focusDevice)) {
      setSelectedId(focusDevice)
      setParams({}, { replace: true })
    }
  }, [focusDevice, customers, setParams])

  const selected = useMemo(() => customers.find((c) => c.deviceId === selectedId) ?? null, [customers, selectedId])
  const list = useMemo(() => sortCustomers(filterCustomers(customers, q, status), sortKey), [customers, q, status, sortKey])

  async function doDeactivate(c: CustomerView) {
    setConfirmDeactivate(null)
    setBusy(true)
    try {
      const { notes } = await deactivateCustomer(c)
      toast('تم تعطيل العميل — يُرفض مفتاحه عند أول مزامنة', 'ok')
      for (const n of notes) toast(n, 'info')
      await refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    setBusy(false)
  }

  function openIssue(c: CustomerView) {
    setSelectedId(c.deviceId)
    setIssueFromRow(true)
    setIssueOpen(true)
  }

  function closeIssue() {
    setIssueOpen(false)
    if (issueFromRow) setSelectedId(null)
    setIssueFromRow(false)
  }

  return (
    <>
      <div className="card" style={{ marginBlockEnd: 14 }}>
        <div className="row">
          <input className="input" style={{ flex: 1, minInlineSize: 220 }} placeholder="🔍 بحث بالاسم / الجهاز / البريد / النشاط…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select" style={{ inlineSize: 165 }} value={status} onChange={(e) => setStatus(e.target.value as CustomerStatus | 'all')}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className="select" style={{ inlineSize: 165 }} value={sortKey} onChange={(e) => setSortKey(e.target.value as CustomerSortKey)}>
            <option value="customer">ترتيب: الاسم</option>
            <option value="expiresAt">ترتيب: الانتهاء</option>
            <option value="lastActivityAt">ترتيب: آخر حدث</option>
            <option value="status">ترتيب: الحالة</option>
          </select>
          <Link className="btn btn-primary" to="/licenses">➕ عميل جديد</Link>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card">
          <EmptyState icon="👥" text={loading ? 'جارٍ التحميل…' : 'لا يوجد عملاء مطابقون'} />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>العميل</th>
                <th>النشاط</th>
                <th>الباقة</th>
                <th>الانتهاء</th>
                <th>آخر ظهور</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.deviceId} className="clickable" onClick={() => setSelectedId(c.deviceId)}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{c.customer || '—'}</div>
                    <div className="mono muted" style={{ fontSize: 11.5 }}>{c.deviceId}</div>
                  </td>
                  <td>{activityLabel(c.clientActivityId ?? c.activityId)}</td>
                  <td>{PLAN_LABELS_AR[c.plan as LicensePlan] ?? (c.plan || '—')}</td>
                  <td className="mono">{c.plan ? (c.expiresAt ?? 'مدى الحياة') : '—'}</td>
                  <td className="muted">{fmtTime(c.lastSeenAt ?? c.lastActivityAt)}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {needsActivation(c)
                      ? <Btn size="sm" kind="primary" onClick={() => openIssue(c)}>✅ تنشيط</Btn>
                      : <Btn size="sm" onClick={() => openIssue(c)}>✏️ تعديل</Btn>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && !issueOpen ? (
        <CustomerCard
          customer={selected}
          busy={busy}
          onClose={() => setSelectedId(null)}
          onIssue={() => { setIssueFromRow(false); setIssueOpen(true) }}
          onDeactivate={() => setConfirmDeactivate(selected)}
        />
      ) : null}

      {selected ? (
        <IssueDialog
          key={`${selected.deviceId}:${issueOpen}`}
          open={issueOpen}
          customer={selected}
          onClose={closeIssue}
          onDone={async () => { await refresh() }}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDeactivate != null}
        title="تعطيل العميل"
        message={`سيُحرق المفتاح الحالي لـ «${confirmDeactivate?.customer || confirmDeactivate?.deviceId || ''}» ويتوقف برنامجه عند أول مزامنة. يمكنك تنشيطه لاحقاً بمفتاح جديد.`}
        confirmText="🔥 تعطيل"
        danger
        onCancel={() => setConfirmDeactivate(null)}
        onConfirm={() => { if (confirmDeactivate) void doDeactivate(confirmDeactivate) }}
      />
    </>
  )
}

/** بطاقة العميل — كل شيء عن العميل في مكان واحد: الاشتراك، المفتاح الحالي، الميزات والأقسام، الإطفاء المؤقت. */
function CustomerCard(props: { customer: CustomerView; busy: boolean; onClose: () => void; onIssue: () => void; onDeactivate: () => void }) {
  const toast = useToast()
  const c = props.customer
  const servicesAvailable = useDataStore((s) => s.servicesAvailable)
  const [flags, setFlags] = useState<{ disabledFeatures: string[]; noteAr: string }>({ disabledFeatures: [], noteAr: '' })
  const [flagsError, setFlagsError] = useState('')
  const [busy, setBusy] = useState(false)
  const activity = resolveClientActivity(c).id
  const included = modulesIncludedInActivity(activity)
  // ما يضيفه المفتاح فوق النشاط فقط — بلا تكرار لقسم مشمول أصلاً
  const extraOnly = c.extraModules.filter((m, i, a) => !included.includes(m) && a.indexOf(m) === i)

  useEffect(() => {
    if (!servicesAvailable) return
    let cancelled = false
    setFlagsError('')
    void readCloudFlags(c.deviceId).then((f) => { if (!cancelled) setFlags(f) }).catch((e: unknown) => {
      // لا نبتلع الخطأ: بدونه تظهر كل الميزات «شغّالة» وهي قد تكون مطفأة
      if (!cancelled) setFlagsError(e instanceof Error ? e.message : String(e))
    })
    return () => { cancelled = true }
  }, [c.deviceId, servicesAvailable])

  async function toggleFlag(f: LicenseFeature, disable: boolean) {
    setBusy(true)
    try {
      await setCloudFlag(c.deviceId, f, disable, disable ? 'تعطيل مؤقت من اللوحة' : '')
      setFlags(await readCloudFlags(c.deviceId))
      setFlagsError('')
      toast(disable ? `🔴 أُطفئت «${FEATURE_LABELS_AR[f]}» مؤقتاً` : `🟢 أُعيد تشغيل «${FEATURE_LABELS_AR[f]}»`, 'ok')
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  async function copyKey() {
    if (!c.licenseKey) return
    try {
      await navigator.clipboard.writeText(c.licenseKey)
      toast('تم نسخ المفتاح ✓', 'ok')
    } catch {
      toast('تعذر النسخ — حدد المفتاح الظاهر وانسخه يدوياً', 'error')
    }
  }

  async function sendKey() {
    if (!c.licenseKey || !c.fingerprint) return
    setBusy(true)
    try {
      await sendKeyToCustomer({ deviceId: c.deviceId, customer: c.customer, key: c.licenseKey, fingerprint: c.fingerprint })
      toast('📨 وصل المفتاح إلى إشعارات تطبيق العميل', 'ok')
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  const plan = (c.plan || 'trial') as LicensePlan
  const knownPlan = isValidPlan(plan)

  return (
    <Modal
      open
      wide
      title={c.customer || c.deviceId}
      sub={`${c.deviceId} · ${STATUS_LABELS_AR[c.status]}`}
      onClose={props.onClose}
      actions={
        <>
          {c.status !== 'revoked' && c.fingerprint ? <Btn kind="danger" disabled={props.busy} onClick={props.onDeactivate}>🔥 تعطيل</Btn> : null}
          <div className="spacer" />
          <Btn onClick={props.onClose}>إغلاق</Btn>
          <Btn kind="primary" onClick={props.onIssue}>{needsActivation(c) ? '✅ تنشيط العميل' : '✏️ تعديل / إضافة قسم أو ميزة'}</Btn>
        </>
      }
    >
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-title">الاشتراك</div>
          <ul className="plain" style={{ fontSize: 13.5 }}>
            <li>الباقة: <b>{PLAN_LABELS_AR[plan] ?? (c.plan || '—')}</b> · ينتهي: <span className="mono">{c.plan ? (c.expiresAt ?? 'مدى الحياة') : '—'}</span></li>
            <li>النشاط: <b>{activityDisplay(c.clientActivityId ?? c.activityId)}</b>
              {c.clientActivityId && c.activityId && c.clientActivityId !== c.activityId ? <span className="muted"> (المفتاح: {activityLabel(c.activityId)})</span> : null}</li>
            {knownPlan ? <li>الفروع: {totalBranches(plan, c.extraBranches)} (منها {c.extraBranches} إضافي) · المستخدمون: {totalUsers(plan, c.extraUsers)}</li> : null}
            <li>آخر ظهور: {fmtTime(c.lastSeenAt)} · آخر حدث: {c.lastActivityAt ?? '—'}</li>
            {c.email ? <li>البريد: {c.email}</li> : null}
            {c.message ? <li>رسالة على حسابه: {c.message}</li> : null}
          </ul>
        </div>

        <div className="card">
          <div className="card-title">الميزات والأقسام</div>
          <div className="row" style={{ marginBlockEnd: 8 }}>
            {c.features.length === 0 ? <span className="muted">لا ميزات</span> : c.features.map((f) => (
              <Badge key={f} kind={flags.disabledFeatures.includes(f) ? 'danger' : 'accent'}>
                {FEATURE_LABELS_AR[f] ?? f}{flags.disabledFeatures.includes(f) ? ' (مطفأة)' : ''}
              </Badge>
            ))}
          </div>
          <div className="row">
            {included.map((m) => <Badge key={m} kind="muted">{MODULE_LABELS_AR[m] ?? m} · ضمن النشاط</Badge>)}
            {extraOnly.map((m) => <Badge key={m} kind="ok">{MODULE_LABELS_AR[m] ?? m} · إضافي</Badge>)}
            {included.length === 0 && extraOnly.length === 0 ? <span className="muted">لا أقسام إضافية</span> : null}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBlockStart: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="card-title" style={{ margin: 0 }}>🔑 المفتاح الحالي</div>
          {c.licenseKey ? (
            <div className="row">
              <span className="muted" style={{ fontSize: 12 }}>صدر {c.licenseIssuedAt ?? '—'} · بصمة <span className="mono">{c.fingerprint}</span></span>
              <Btn size="sm" onClick={() => void copyKey()}>نسخ</Btn>
              <Btn size="sm" kind="primary" disabled={busy || c.status === 'revoked' || c.status === 'expired'} title={c.status === 'expired' ? 'المفتاح منتهٍ — جدّد أولاً' : undefined} onClick={() => void sendKey()}>📨 إرسال للعميل</Btn>
            </div>
          ) : null}
        </div>
        {c.licenseKey ? (
          <div className="mono muted" style={{ wordBreak: 'break-all', fontSize: 11.5, marginBlockStart: 8 }}>{c.licenseKey}</div>
        ) : <div className="muted" style={{ marginBlockStart: 8 }}>لا يوجد مفتاح لهذا الجهاز بعد.</div>}
        <ActivationExplainer />
      </div>

      {c.features.length > 0 ? (
        <div className="card" style={{ marginBlockStart: 12 }}>
          <div className="card-title">⚡ إطفاء مؤقت لميزة (بدون مفتاح جديد)</div>
          {!servicesAvailable ? (
            <div className="muted" style={{ fontSize: 12.5 }}>يحتاج مساحة الخدمات — <Link to="/settings">اضبطها من الإعدادات</Link>.</div>
          ) : (
            <>
              {flagsError ? <div style={{ color: 'var(--danger)', fontSize: 12.5, marginBlockEnd: 8 }}>⚠️ تعذر قراءة حالة الإطفاء الحالية — {flagsError}. الأزرار قد لا تعكس الواقع.</div> : null}
              <div className="muted" style={{ fontSize: 12.5, marginBlockEnd: 8 }}>مناسب لتأخر السداد مثلاً — يُطفئ الميزة من السحابة ويعيدها بنقرة.</div>
              {LICENSE_FEATURES.filter((f) => c.features.includes(f)).map((f) => {
                const off = flags.disabledFeatures.includes(f)
                return (
                  <div key={f} className="check-row">
                    <span style={{ flex: 1 }}>{FEATURE_LABELS_AR[f]}{off ? <span className="check-desc"> — مطفأة حالياً</span> : null}</span>
                    {off
                      ? <Btn size="sm" kind="primary" disabled={busy} onClick={() => void toggleFlag(f, false)}>إعادة تشغيل</Btn>
                      : <Btn size="sm" kind="danger" disabled={busy} onClick={() => void toggleFlag(f, true)}>إطفاء</Btn>}
                  </div>
                )
              })}
            </>
          )}
        </div>
      ) : null}
    </Modal>
  )
}

/** تنشيط / تجديد / تعديل عميل موجود — نفس نموذج الإصدار الموحّد معبّأً من اشتراكه. */
export function IssueDialog(props: {
  open: boolean
  customer: CustomerView
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const c = props.customer
  return (
    <Modal open={props.open} wide dismissible={false}
      title={needsActivation(c) ? `تنشيط العميل — ${c.customer || c.deviceId}` : `تعديل اشتراك — ${c.customer || c.deviceId}`}
      sub="المفتاح الجديد يحلّ محل القديم ويحمل كل الأقسام والميزات"
      onClose={props.onClose}>
      <IssueForm customer={c} onIssued={async () => { await props.onDone() }} onClose={props.onClose} />
    </Modal>
  )
}
