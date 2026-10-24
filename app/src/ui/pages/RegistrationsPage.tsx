import { useEffect, useMemo, useState } from 'react'
import { useDataStore } from '../../stores/data.store.ts'
import { bridge } from '../../data/bridge.ts'
import { filterRegistrations, PENDING_LABELS, type RegistrationRecord } from '../../core/registrations.ts'
import { Btn, Badge, EmptyState, Modal, useToast, ConfirmDialog } from '../components/ui.tsx'
import { IssueForm } from '../components/IssueForm.tsx'
import { Users, Phone, Mail, MapPin, Activity, Copy, Trash2, KeyRound, Search, RefreshCw } from 'lucide-react'

const fmtDate = (iso: string) => iso ? iso.slice(0, 16).replace('T', ' ') : '—'

export function RegistrationsPage() {
  const toast = useToast()
  const { registrations, pendingRegistrations, refresh, pollRegistrations, loading, unreadNew, markRegistrationsSeen } = useDataStore()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'new' | 'licensed'>('all')
  const [selected, setSelected] = useState<RegistrationRecord | null>(null)
  const [issueFor, setIssueFor] = useState<RegistrationRecord | null>(null)
  const [deleteFor, setDeleteFor] = useState<RegistrationRecord | null>(null)

  useEffect(() => {
    if (!useDataStore.getState().lastSyncAt) void refresh()
    else void pollRegistrations(30_000)
  }, [refresh, pollRegistrations])
  useEffect(() => {
    // عند فتح الصفحة نعلّم التسجيلات كمقروءة بعد ثانيتين (حتى يراها المستخدم)
    const t = setTimeout(() => markRegistrationsSeen(), 1200)
    return () => clearTimeout(t)
  }, [markRegistrationsSeen])

  const devLicensed = useMemo(() => {
    const m = new Map<string, boolean>()
    // نحسب هل الجهاز مرخّص من حالة pendingRegistrations: إن لم يكن في pending فهو مرخص أو قديم بلا تسجيل
    const pendingSet = new Set(pendingRegistrations.map((r) => r.deviceId))
    for (const r of registrations) m.set(r.deviceId, !pendingSet.has(r.deviceId))
    return m
  }, [registrations, pendingRegistrations])

  const filtered = useMemo(() => {
    let list = registrations
    if (filter === 'new') list = pendingRegistrations
    if (filter === 'licensed') list = registrations.filter((r) => devLicensed.get(r.deviceId))
    return filterRegistrations(list, q)
  }, [registrations, pendingRegistrations, filter, q, devLicensed])

  const stats = useMemo(() => ({
    total: registrations.length,
    pending: pendingRegistrations.length,
    licensed: registrations.length - pendingRegistrations.length,
  }), [registrations, pendingRegistrations])

  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); toast(`تم نسخ ${label} ✓`, 'ok') }
    catch { toast('تعذر النسخ', 'error') }
  }

  async function doDelete() {
    if (!deleteFor) return
    try {
      const res = await bridge.cf.delete('license', `reg:${deleteFor.deviceId}`)
      if (!res.ok) throw new Error(res.error ?? 'تعذر الحذف')
      toast(`🗑️ حُذف تسجيل ${deleteFor.shopName || deleteFor.deviceId}`, 'ok')
      setDeleteFor(null)
      await refresh()
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBlockEnd: 12 }}>
        <h2 style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Users size={20} /> التسجيلات الجديدة
          {unreadNew > 0 ? <Badge kind="warn">{unreadNew} جديد</Badge> : null}
        </h2>
        <div className="row">
          <Badge kind="muted">الكل {stats.total}</Badge>
          <Badge kind="warn">بانتظار التفعيل {stats.pending}</Badge>
          <Badge kind="ok">مرخّص {stats.licensed}</Badge>
          <Btn size="sm" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} /> تحديث</Btn>
        </div>
      </div>

      {pendingRegistrations.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warn)', background: 'var(--warn-bg, rgba(251,191,36,0.08))', marginBlockEnd: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 18 }}>🆕</span>
            <div style={{ flex: 1 }}>
              <b>{pendingRegistrations.length} عميل جديد بانتظار التفعيل</b>
              <div className="muted" style={{ fontSize: 12.5 }}>
                هؤلاء أكملوا معالج أول التشغيل وأُرسلت بياناتهم تلقائياً — اضغط «إصدار مفتاح» لتفعيلهم فوراً. سيصلهم المفتاح في إشعارات التطبيق.
              </div>
            </div>
            <Btn size="sm" kind="primary" onClick={() => setFilter('new')}>عرض الجدد فقط</Btn>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBlockEnd: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', insetInlineStart: 10, insetBlockStart: 10, opacity: 0.5 }} />
            <input className="input" style={{ paddingInlineStart: 32 }} placeholder="بحث: اسم المحل، المالك، الهاتف، البريد، الجهاز، النشاط، المدينة…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Btn size="sm" kind={filter === 'all' ? 'primary' : 'default'} onClick={() => setFilter('all')}>الكل</Btn>
            <Btn size="sm" kind={filter === 'new' ? 'primary' : 'default'} onClick={() => setFilter('new')}>بانتظار التفعيل</Btn>
            <Btn size="sm" kind={filter === 'licensed' ? 'primary' : 'default'} onClick={() => setFilter('licensed')}>مرخّص</Btn>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card"><EmptyState icon="📋" text={q ? 'لا نتائج للبحث' : filter === 'new' ? 'لا يوجد عملاء جدد حالياً' : 'لا تسجيلات بعد'} hint={q ? 'جرّب كلمة أخرى' : 'يظهر هنا كل عميل يثبّت التطبيق ويكمل التسجيل — تلقائياً'} /></div>
      ) : (
        <>
          <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12 }}>
            {filtered.slice(0, 200).map((r) => {
            const licensed = devLicensed.get(r.deviceId) ?? false
            const isNew = !licensed
            return (
              <div key={r.deviceId} className="card" style={{ borderColor: isNew ? 'var(--warn)' : undefined, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 15, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {r.shopName || 'بلا اسم محل'}
                      {isNew ? <Badge kind="warn">جديد</Badge> : <Badge kind="ok">مرخّص</Badge>}
                      {r.pendingChanges ? <Badge kind="danger">تحديث معلّق</Badge> : null}
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>{r.ownerName || 'بلا اسم مالك'}</div>
                    <div className="mono muted" style={{ fontSize: 11.5 }}>{r.deviceId}</div>
                  </div>
                  <Btn size="sm" onClick={() => setSelected(r)}>تفاصيل</Btn>
                </div>

                <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {r.phone ? <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Phone size={12} /> <span dir="ltr">{r.phone}</span> <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => void copy(r.phone, 'الهاتف')}><Copy size={10} /> نسخ</button></div> : null}
                  {r.email ? <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Mail size={12} /> <span>{r.email}</span> <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => void copy(r.email, 'البريد')}><Copy size={10} /> نسخ</button></div> : null}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><MapPin size={12} /> {r.city || ''}{r.city && r.street ? ' — ' : ''}{r.street || 'بلا عنوان'} {r.countryCode ? `(${r.countryCode})` : ''}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Activity size={12} /> {r.activityNameAr || r.activityId || 'غير محدد'} {r.activityId ? <span className="muted">({r.activityId})</span> : null}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>التسجيل: {fmtDate(r.registeredAt)} · آخر ظهور: {fmtDate(r.lastSeenAt)} · بلاغات: {r.reports}{r.appVersion ? ` · إصدار ${r.appVersion}` : ''}{r.platform ? ` · ${r.platform}` : ''}</div>
                  {r.pendingChanges ? (
                    <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '6px 8px', fontSize: 12 }}>
                      ⚠️ بيانات جديدة لم تُعتمد من بلاغ لاحق ({r.pendingAt ? fmtDate(r.pendingAt) : ''}): {Object.entries(r.pendingChanges).map(([k, v]) => `${PENDING_LABELS[k] ?? k}: ${v}`).join(' · ')}
                    </div>
                  ) : null}
                </div>

                <div className="row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                  <Btn size="sm" kind="primary" onClick={() => setIssueFor(r)}><KeyRound size={12} /> إصدار مفتاح</Btn>
                  <Btn size="sm" onClick={() => void copy(r.deviceId, 'المعرّف')}><Copy size={12} /> نسخ المعرّف</Btn>
                  {r.phone ? <Btn size="sm" onClick={() => window.open(`tel:${r.phone}`, '_blank')}><Phone size={12} /> اتصال</Btn> : null}
                  <Btn size="sm" kind="danger" onClick={() => setDeleteFor(r)}><Trash2 size={12} /> حذف</Btn>
                </div>
              </div>
            )
            })}
          </div>
          {filtered.length > 200 ? <div className="muted" style={{ textAlign: 'center', marginBlockStart: 8 }}>عرض 200 من {filtered.length} — استخدم البحث للتصفية</div> : null}
        </>
      )}

      {selected ? <RegistrationDetailModal record={selected} licensed={devLicensed.get(selected.deviceId) ?? false} onClose={() => setSelected(null)} onIssue={() => { setSelected(null); setIssueFor(selected) }} /> : null}

      {issueFor ? (
        <Modal open wide title={`إصدار مفتاح — ${issueFor.shopName || issueFor.ownerName || issueFor.deviceId}`} sub={issueFor.deviceId} onClose={() => setIssueFor(null)}>
          <RegistrationIssueForm record={issueFor} onIssued={async () => { await refresh(); setIssueFor(null) }} onClose={() => setIssueFor(null)} />
        </Modal>
      ) : null}

      <ConfirmDialog
        open={deleteFor != null}
        title="حذف التسجيل"
        message={`سيُحذف سجل التسجيل للجهاز ${deleteFor?.deviceId ?? ''} (${deleteFor?.shopName || ''}). الرخصة إن وجدت لن تُحذف — لحذف الرخصة استخدم «حرق» من صفحة العملاء.`}
        confirmText="🗑️ حذف"
        danger
        onCancel={() => setDeleteFor(null)}
        onConfirm={() => void doDelete()}
      />
    </>
  )
}

function RegistrationDetailModal(props: { record: RegistrationRecord; licensed: boolean; onClose: () => void; onIssue: () => void }) {
  const r = props.record
  return (
    <Modal open wide title={r.shopName || 'تفاصيل التسجيل'} sub={`${r.deviceId} · ${props.licensed ? 'مرخّص' : 'بانتظار التفعيل'}`} onClose={props.onClose}
      actions={<><Btn onClick={props.onClose}>إغلاق</Btn><Btn kind="primary" onClick={props.onIssue}><KeyRound size={12} /> إصدار مفتاح</Btn></>}>
      <div className="grid-2">
        <div className="card"><div className="card-title">بيانات المحل والمالك</div>
          <ul className="plain" style={{ fontSize: 13.5 }}>
            <li>المنشأة: <b>{r.shopName || '—'}</b></li>
            <li>المالك: <b>{r.ownerName || '—'}</b></li>
            <li>الهاتف: <span dir="ltr">{r.phone || '—'}</span></li>
            <li>البريد: {r.email || '—'}</li>
            <li>العنوان: {r.city || '—'}{r.street ? ` — ${r.street}` : ''}</li>
            <li>الدولة: {r.countryCode || '—'}</li>
          </ul>
        </div>
        <div className="card"><div className="card-title">النشاط والنظام</div>
          <ul className="plain" style={{ fontSize: 13.5 }}>
            <li>النشاط: <b>{r.activityNameAr || '—'}</b> {r.activityId ? <span className="muted">({r.activityId})</span> : null}</li>
            {r.doctorSpecialty ? <li>التخصص: {r.doctorSpecialty}</li> : null}
            <li>الخطة: {r.plan || '—'} · المحاسبة: {r.accountingMode || '—'}</li>
            <li>المنصة: {r.platform || '—'} · الإصدار: {r.appVersion || '—'}</li>
            <li>السنة المالية: {r.fiscalYearName || '—'} {r.fiscalYearStart ? `(${r.fiscalYearStart} → ${r.fiscalYearEnd})` : ''}</li>
          </ul>
        </div>
      </div>
      <div className="card" style={{ marginBlockStart: 12 }}><div className="card-title">سجل البلاغات</div>
        <ul className="plain" style={{ fontSize: 13.5 }}>
          <li>أول بلاغ: {fmtDate(r.firstSeenAt)}</li>
          <li>آخر بلاغ: {fmtDate(r.lastSeenAt)}</li>
          <li>التسجيل: {fmtDate(r.registeredAt)}</li>
          <li>عدد البلاغات: {r.reports}</li>
          {r.pendingChanges ? <li style={{ color: 'var(--danger)' }}>⚠️ تحديث معلّق: {Object.entries(r.pendingChanges).map(([k, v]) => `${PENDING_LABELS[k] ?? k}: ${v}`).join(' · ')} (من {r.pendingAt ? fmtDate(r.pendingAt) : '—'})</li> : null}
        </ul>
        <div className="mono muted" style={{ fontSize: 11, marginBlockStart: 8 }}>{r.deviceId}</div>
      </div>
    </Modal>
  )
}

function RegistrationIssueForm(props: { record: RegistrationRecord; onIssued: () => void | Promise<void>; onClose: () => void }) {
  const r = props.record
  // نمرّر بيانات التسجيل كـ customer وهمي لـ IssueForm عبر بناء CustomerView مصغر
  const toast = useToast()
  // نبني عميل وهمي ليعبئ IssueForm تلقائياً
  const syntheticCustomer = useMemo(() => ({
    deviceId: r.deviceId,
    customer: r.shopName || r.ownerName || 'عميل جديد',
    email: r.email || null,
    plan: '',
    expiresAt: null,
    activityId: r.activityId ?? null,
    clientActivityId: r.activityId ?? r.activityNameAr ?? null,
    features: [] as string[],
    extraUsers: 0,
    extraBranches: 0,
    extraModules: [] as string[],
    fingerprint: null,
    licenseKey: null,
    licenseIssuedAt: null,
    lastSeenAt: r.lastSeenAt ?? null,
    status: 'none' as const,
    lastActivityAt: null,
    lastSupportAt: null,
    supportUnread: false,
    message: '',
  }), [r])

  // نعرض IssueForm مع ملاحظة ببيانات التسجيل
  return (
    <div>
      <div className="notice notice-info" style={{ display: 'block', marginBlockEnd: 10 }}>
        📋 بيانات من التسجيل: <b>{r.shopName}</b> — {r.ownerName} — {r.phone} — {r.email} — {r.activityNameAr || r.activityId}
      </div>
      <IssueForm customer={syntheticCustomer as any} onIssued={async () => {
        toast(`✅ صدر المفتاح لـ ${r.shopName || r.deviceId} — أُرسل للعميل تلقائياً؟ اضغط «إرسال للعميل» لإيصاله في إشعاراته`, 'ok')
        await props.onIssued()
      }} onClose={props.onClose} />
    </div>
  )
}
