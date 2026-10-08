import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDataStore } from '../../stores/data.store.ts'
import { deactivateCustomer, issueForKey } from '../../data/customerActions.ts'
import { filterCustomers, sortCustomers, STATUS_LABELS_AR, type CustomerStatus, type CustomerView, type CustomerSortKey } from '../../core/customers.ts'
import { PLAN_LABELS_AR, LICENSE_FEATURES, FEATURE_LABELS_AR, MODULE_LABELS_AR, EXTRA_MODULES, type LicensePlan } from '../../core/license.ts'
import { DEFAULT_BINDING } from '../../core/settings.ts'
import { Btn, Modal, useToast, EmptyState, Field, Select } from '../components/ui.tsx'
import { StatusBadge } from './DashboardPage.tsx'
import { LicenseKeyResult } from '../components/LicenseKeyResult.tsx'

const STATUS_OPTIONS: { value: CustomerStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'كل الحالات' },
  { value: 'active', label: 'نشط' },
  { value: 'expiring', label: 'قرب الانتهاء' },
  { value: 'expired', label: 'منتهٍ' },
  { value: 'revoked', label: 'محروق' },
]

const PLAN_OPTIONS = (Object.keys(PLAN_LABELS_AR) as LicensePlan[]).map((p) => ({ value: p, label: PLAN_LABELS_AR[p] }))

export function CustomersPage() {
  const toast = useToast()
  const [params] = useSearchParams()
  const { customers, refresh, loading } = useDataStore()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<CustomerStatus | 'all'>('all')
  const [sortKey, setSortKey] = useState<CustomerSortKey>('customer')
  const [selected, setSelected] = useState<CustomerView | null>(null)
  const [renewOpen, setRenewOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const focusDevice = params.get('focus')

  useEffect(() => { void refresh() }, [refresh])

  // keep the open card in sync with fresh data
  useEffect(() => {
    if (selected) {
      const fresh = customers.find((c) => c.deviceId === selected.deviceId)
      if (fresh && fresh !== selected) setSelected(fresh)
    }
  }, [customers, selected])

  const list = useMemo(() => sortCustomers(filterCustomers(customers, q, status), sortKey), [customers, q, status, sortKey])

  async function doDeactivate(c: CustomerView) {
    setBusy(true)
    try {
      await deactivateCustomer(c)
      toast('تم تعطيل العميل — سيُرفض المفتاح عند أول مزامنة', 'ok')
      await refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    setBusy(false)
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
            <option value="lastActivityAt">ترتيب: آخر نشاط</option>
            <option value="status">ترتيب: الحالة</option>
          </select>
          <Btn onClick={() => void refresh()} disabled={loading}>{loading ? '…' : 'تحديث'}</Btn>
        </div>
      </div>

      {focusDevice ? (
        <div className="card" style={{ marginBlockEnd: 14, borderColor: 'var(--accent)' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <b>تركيز على الجهاز</b>
              <div className="mono muted">{focusDevice}</div>
            </div>
            <Btn kind="primary" onClick={() => { const c = customers.find((x) => x.deviceId === focusDevice); if (c) setSelected(c) }}>فتح البطاقة</Btn>
          </div>
        </div>
      ) : null}

      {list.length === 0 ? (
        <div className="card">
          <EmptyState icon="👥" text={loading ? 'جارٍ التحميل…' : 'لا يوجد عملاء مطابقون'} hint="البيانات تُقرأ مباشرة من Cloudflare KV" />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>العميل</th>
                <th>الجهاز</th>
                <th>النشاط</th>
                <th>الباقة</th>
                <th>الانتهاء</th>
                <th>آخر ظهور</th>
                <th>آخر دعم</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.deviceId} className="clickable" onClick={() => setSelected(c)}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{c.customer || '—'}</div>
                    {c.email ? <div className="muted" style={{ fontSize: 12 }}>{c.email}</div> : null}
                  </td>
                  <td className="mono">{c.deviceId}</td>
                  <td>{c.activityId ?? '—'}</td>
                  <td>{PLAN_LABELS_AR[c.plan as LicensePlan] ?? c.plan ?? '—'}</td>
                  <td className="mono">{c.expiresAt ?? 'مدى الحياة'}</td>
                  <td className="muted">{c.lastActivityAt ?? '—'}</td>
                  <td className="muted">{c.lastSupportAt ? c.lastSupportAt.slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row">
                      <Btn size="sm" onClick={() => setSelected(c)}>تفاصيل</Btn>
                      {c.status !== 'revoked' ? (
                        <Btn size="sm" kind="danger" disabled={busy} onClick={() => void doDeactivate(c)}>تعطيل</Btn>
                      ) : (
                        <Btn size="sm" kind="primary" onClick={() => { setSelected(c); setRenewOpen(true) }}>تنشيط</Btn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={selected != null}
        wide
        title={selected ? `بطاقة العميل — ${selected.customer || selected.deviceId}` : ''}
        sub={selected ? `الحالة: ${STATUS_LABELS_AR[selected.status]} · آخر ظهور: ${selected.lastActivityAt ?? '—'}` : ''}
        onClose={() => setSelected(null)}
        actions={
          selected ? (
            <>
              <Btn onClick={() => setSelected(null)}>إغلاق</Btn>
              <Btn kind="primary" onClick={() => setRenewOpen(true)}>
                {selected.status === 'revoked' || selected.status === 'expired' || selected.status === 'none' ? '✅ إعادة التنشيط' : '🔁 تجديد وتعديل'}
              </Btn>
              {selected.status !== 'revoked' ? (
                <Btn kind="danger" disabled={busy} onClick={() => void doDeactivate(selected)}>🔥 تعطيل (حرق)</Btn>
              ) : null}
            </>
          ) : null
        }
      >
        {selected ? (
          <>
            <div className="grid-2">
              <div className="card">
                <div className="card-title">بيانات الاشتراك</div>
                <ul className="plain" style={{ fontSize: 13.5 }}>
                  <li>الباقة: <b>{PLAN_LABELS_AR[selected.plan as LicensePlan] ?? selected.plan ?? '—'}</b></li>
                  <li>الانتهاء: <span className="mono">{selected.expiresAt ?? 'مدى الحياة'}</span></li>
                  <li>البصمة: <span className="mono">{selected.fingerprint ?? '—'}</span></li>
                  <li>مستخدمون إضافيون: {selected.extraUsers} · فروع إضافية: {selected.extraBranches}</li>
                  <li>رسالة العميل: {selected.message || '—'}</li>
                </ul>
              </div>
              <div className="card">
                <div className="card-title">الميزات الممنوحة</div>
                {selected.features.length === 0 ? <span className="muted">لا ميزات ممنوحة</span> : (
                  <ul className="plain" style={{ fontSize: 13.5 }}>
                    {selected.features.map((f) => <li key={f}>{FEATURE_LABELS_AR[f] ?? f}</li>)}
                  </ul>
                )}
                <div className="section-title" style={{ marginBlockStart: 12 }}>أقسام إضافية</div>
                {selected.extraModules.length === 0 ? <span className="muted">لا أقسام إضافية</span> : (
                  <ul className="plain" style={{ fontSize: 13.5 }}>
                    {selected.extraModules.map((m) => <li key={m}>{MODULE_LABELS_AR[m] ?? m}</li>)}
                  </ul>
                )}
              </div>
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginBlockStart: 10 }}>
              ℹ️ لتغيير الميزات أو الأقسام: «تجديد وتعديل» يصدر <b>مفتاحاً جديداً</b> — نفس قاعدة البوت
              (التغييرات تسري بمفتاح جديد). التعطيل يتم برفض المفتاح عند أول مزامنة للعميل.
            </div>
          </>
        ) : null}
      </Modal>

      {selected ? (
        <IssueDialog
          open={renewOpen}
          customer={selected}
          onClose={() => setRenewOpen(false)}
          onDone={async () => { setRenewOpen(false); await refresh() }}
        />
      ) : null}
    </>
  )
}

/** Issue / renew for an existing device — prefilled from the customer view. */
export function IssueDialog(props: {
  open: boolean
  customer: CustomerView
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const toast = useToast()
  const c = props.customer
  const [customerName, setCustomerName] = useState(c.customer)
  const [plan, setPlan] = useState<LicensePlan>((c.plan as LicensePlan) || 'basic')
  const [days, setDays] = useState('365')
  const [activityId, setActivityId] = useState(c.activityId ?? '')
  const [extraUsers, setExtraUsers] = useState(c.extraUsers ? String(c.extraUsers) : '')
  const [extraBranches, setExtraBranches] = useState(c.extraBranches ? String(c.extraBranches) : '')
  const [features, setFeatures] = useState<string[]>([...c.features])
  const [modules, setModules] = useState<string[]>([...c.extraModules])
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<{ key: string; fingerprint: string } | null>(null)

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value])

  async function submit() {
    setBusy(true)
    try {
      const res = await issueForKey({
        deviceId: c.deviceId,
        customer: customerName.trim() || c.customer,
        plan,
        days: Number(days) || 365,
        activityId: activityId.trim() || undefined,
        extraUsers: Number(extraUsers) || 0,
        extraBranches: Number(extraBranches) || 0,
        features: features as never,
        extraModules: modules,
      })
      setIssued({ key: res.key, fingerprint: res.fingerprint })
      toast('تم إصدار المفتاح ورفعه إلى Cloudflare ✓', 'ok')
      await props.onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    setBusy(false)
  }

  if (issued) {
    return (
      <Modal open={props.open} title="مفتاح التفعيل الجديد" sub={c.customer || c.deviceId} onClose={props.onClose}
        actions={<Btn kind="primary" onClick={props.onClose}>تم</Btn>}>
        <LicenseKeyResult licenseKey={issued.key} fingerprint={issued.fingerprint} onCopy={() => toast('تم نسخ المفتاح ✓', 'ok')} />
      </Modal>
    )
  }

  return (
    <Modal open={props.open} wide title="تجديد وتعديل الاشتراك" sub={c.deviceId} onClose={props.onClose}
      actions={
        <>
          <Btn onClick={props.onClose}>إلغاء</Btn>
          <Btn kind="primary" disabled={busy} onClick={() => void submit()}>{busy ? 'جارٍ التوقيع…' : 'إصدار المفتاح الجديد'}</Btn>
        </>
      }>
      <div className="grid-2">
        <Field label="اسم العميل" value={customerName} onChange={setCustomerName} />
        <Select label="الخطة" value={plan} onChange={(v) => setPlan(v as LicensePlan)} options={PLAN_OPTIONS} />
        <Field label="مدة الاشتراك (أيام)" value={days} onChange={setDays} dir="ltr" hint="0 أو مدى الحياة باختيار الخطة «مدى الحياة»" />
        <Field label="النشاط (activityId)" value={activityId} onChange={setActivityId} dir="ltr" placeholder="grocery / pharmacy …" />
        <Field label="مستخدمون إضافيون (+)" value={extraUsers} onChange={setExtraUsers} dir="ltr" />
        <Field label="فروع إضافية (+)" value={extraBranches} onChange={setExtraBranches} dir="ltr" />
      </div>
      <div className="section-title">الميزات</div>
      {LICENSE_FEATURES.map((f) => (
        <label key={f} className="check-row">
          <input type="checkbox" checked={features.includes(f)} onChange={() => toggle(features, setFeatures, f)} />
          <span>{FEATURE_LABELS_AR[f]}<span className="check-desc"> — {f}</span></span>
        </label>
      ))}
      <div className="section-title">أقسام إضافية (extraModules)</div>
      {EXTRA_MODULES.map((m) => (
        <label key={m} className="check-row">
          <input type="checkbox" checked={modules.includes(m)} onChange={() => toggle(modules, setModules, m)} />
          <span>{MODULE_LABELS_AR[m] ?? m}<span className="check-desc"> — {m}</span></span>
        </label>
      ))}
      <div className="muted" style={{ fontSize: 12.5, marginBlockStart: 8 }}>
        ستُكتب السجلات في: <span className="mono">lic:&lt;fingerprint&gt;</span> و<span className="mono">dev:{c.deviceId}</span> و
        <span className="mono">log:{c.deviceId}</span> — ونسخة الاشتراك في <span className="mono">sub:</span> بخدمات التطبيق.
        الجهة: <span className="mono">{DEFAULT_BINDING.licenseWorkerUrl}</span>
      </div>
    </Modal>
  )
}
