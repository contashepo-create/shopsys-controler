import { useEffect, useState } from 'react'
import { bridge } from '../../data/bridge.ts'
import { revokeLicense, readGlobalDefaults, updateGlobalSettings } from '../../data/actions.ts'
import { useDataStore } from '../../stores/data.store.ts'
import {
  DEVICE_ID_RE, keyFingerprint, LICENSE_FEATURES, FEATURE_LABELS_AR, MODULE_LABELS_AR, EXTRA_MODULES,
  PLAN_LABELS_AR, type LicensePlan, type LicenseFeature,
} from '../../core/license.ts'
import { DERIVED_FEATURES, durationDays, finalFeatures, toCount, totalBranches } from '../../core/issueForm.ts'
import { activityDisplay } from '../../core/activities.ts'
import { Btn, Field, Select, useToast, Badge, EmptyState } from '../components/ui.tsx'
import { IssueForm } from '../components/IssueForm.tsx'

type Tab = 'issue' | 'search' | 'defaults'

export function LicensesPage() {
  const [tab, setTab] = useState<Tab>('issue')
  const refresh = useDataStore((s) => s.refresh)
  useEffect(() => { void refresh() }, [refresh])
  return (
    <>
      <div className="tabs">
        <Btn kind={tab === 'issue' ? 'primary' : 'default'} onClick={() => setTab('issue')}>🔑 إصدار مفتاح</Btn>
        <Btn kind={tab === 'search' ? 'primary' : 'default'} onClick={() => setTab('search')}>🔍 بحث / حرق</Btn>
        <Btn kind={tab === 'defaults' ? 'primary' : 'default'} onClick={() => setTab('defaults')}>⚙️ افتراضيات الجهاز الجديد</Btn>
      </div>
      {tab === 'issue' ? (
        <div className="card"><IssueForm onIssued={async () => { await refresh() }} /></div>
      ) : tab === 'search' ? <SearchTab /> : <DefaultsTab />}
    </>
  )
}

const PLAN_OPTIONS = (Object.keys(PLAN_LABELS_AR) as LicensePlan[]).map((p) => ({ value: p, label: PLAN_LABELS_AR[p] }))
const SELECTABLE_FEATURES = LICENSE_FEATURES.filter((f) => !DERIVED_FEATURES.includes(f))

/** settings:global — ما يُعبّأ تلقائياً في نموذج الإصدار لأي جهاز جديد (يقرؤه البوت أيضاً). */
function DefaultsTab() {
  const toast = useToast()
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const [plan, setPlan] = useState<LicensePlan>('basic')
  const [days, setDays] = useState('365')
  const [users, setUsers] = useState('')
  const [branches, setBranches] = useState('')
  const [features, setFeatures] = useState<LicenseFeature[]>([])
  const [modules, setModules] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(false); setLoadError('')
    void readGlobalDefaults().then((d) => {
      if (cancelled) return
      setPlan(d.plan); setDays(String(d.days))
      setUsers(d.extraUsers ? String(d.extraUsers) : ''); setBranches(d.extraBranches ? String(d.extraBranches) : '')
      setFeatures(d.features.filter((f) => !DERIVED_FEATURES.includes(f))); setModules(d.extraModules)
      setLoaded(true)
    }).catch((e: unknown) => {
      // لا نعرض نموذجاً بقيم مبدئية: حفظه كان سيكتب فوق الافتراضيات الحقيقية
      if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
    })
    return () => { cancelled = true }
  }, [reload])

  const toggle = <T,>(list: T[], set: (v: T[]) => void, v: T) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  async function save() {
    setBusy(true)
    try {
      await updateGlobalSettings({
        plan, days: durationDays(days), extraUsers: toCount(users), extraBranches: toCount(branches),
        features: finalFeatures(features, plan, toCount(branches)), extraModules: modules,
      })
      toast('تم حفظ الافتراضيات ✓ — ستُعبّأ تلقائياً عند إصدار مفتاح لجهاز جديد', 'ok')
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  if (loadError) {
    return (
      <div className="card">
        <EmptyState icon="⚠️" text="تعذر قراءة الافتراضيات الحالية" hint={`${loadError} — لم نعرض النموذج حتى لا تُحفظ قيم مبدئية فوق إعدادك`} />
        <div className="row" style={{ justifyContent: 'center' }}><Btn kind="primary" onClick={() => setReload((n) => n + 1)}>إعادة المحاولة</Btn></div>
      </div>
    )
  }
  if (!loaded) return <div className="card"><EmptyState icon="⏳" text="جارٍ التحميل…" /></div>

  return (
    <div className="card">
      <div className="muted" style={{ fontSize: 13, marginBlockEnd: 12 }}>
        تُعبّأ هذه القيم تلقائياً في نموذج الإصدار لكل <b>جهاز جديد</b> — فلا تختار الميزات كل مرة.
        أما العميل المسجَّل فيُعبّأ النموذج من اشتراكه الحالي.
      </div>
      <div className="grid-2">
        <Select label="الباقة" value={plan} onChange={(v) => setPlan(v as LicensePlan)} options={PLAN_OPTIONS} />
        <Field label="المدة (أيام)" value={days} onChange={setDays} dir="ltr" hint="0 = مدى الحياة" />
        <Field label="فروع إضافية بجانب الرئيسي" value={branches} onChange={setBranches} dir="ltr" placeholder="0"
          hint={`الحد الكلي: ${totalBranches(plan, toCount(branches))}`} />
        <Field label="مستخدمون إضافيون" value={users} onChange={setUsers} dir="ltr" placeholder="0" />
      </div>
      <div className="section-title">الميزات</div>
      <div className="chip-grid">
        {SELECTABLE_FEATURES.map((f) => (
          <label key={f} className={`chip-check${features.includes(f) ? ' on' : ''}`}>
            <input type="checkbox" checked={features.includes(f)} onChange={() => toggle(features, setFeatures, f)} />
            <span>{FEATURE_LABELS_AR[f]}</span>
          </label>
        ))}
      </div>
      <div className="section-title">أقسام إضافية</div>
      <div className="chip-grid">
        {EXTRA_MODULES.map((m) => (
          <label key={m} className={`chip-check${modules.includes(m) ? ' on' : ''}`}>
            <input type="checkbox" checked={modules.includes(m)} onChange={() => toggle(modules, setModules, m)} />
            <span>{MODULE_LABELS_AR[m] ?? m}</span>
          </label>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginBlockStart: 14 }}>
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>حفظ الافتراضيات</Btn>
      </div>
    </div>
  )
}

function SearchTab() {
  const toast = useToast()
  const refresh = useDataStore((s) => s.refresh)

  async function copyKey(key: string | undefined) {
    if (!key) return
    try {
      await navigator.clipboard.writeText(key)
      toast('تم نسخ المفتاح ✓', 'ok')
    } catch { toast('تعذر النسخ — حدد المفتاح وانسخه يدوياً', 'error') }
  }
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ raw: string; fingerprint: string; revoked: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  async function search() {
    const q = query.trim()
    if (!q) return
    setBusy(true)
    try {
      let fp: string
      if (DEVICE_ID_RE.test(q.toUpperCase())) {
        // بحث بمعرّف الجهاز → بصمة مفتاحه الحالي من dev:
        const dev = await bridge.cf.get('license', `dev:${q.toUpperCase()}`)
        if (!dev.ok) throw new Error(dev.error ?? 'تعذر قراءة سجل الجهاز')
        let devFp: string | undefined
        try { devFp = dev.ok && dev.value ? (JSON.parse(dev.value) as { fingerprint?: string }).fingerprint : undefined } catch { devFp = undefined }
        if (!devFp) { setResult(null); toast('لا يوجد مفتاح لهذا الجهاز', 'error'); setBusy(false); return }
        fp = devFp
      } else {
        fp = /^[0-9a-f]{8}$/i.test(q) ? q.toLowerCase() : keyFingerprint(q)
      }
      const rec = await bridge.cf.get('license', `lic:${fp}`)
      if (!rec.ok) throw new Error(rec.error ?? 'تعذر القراءة')
      if (!rec.value) { setResult(null); toast(`لا سجل للبصمة ${fp}`, 'error'); setBusy(false); return }
      const revokedRaw = await bridge.cf.get('license', 'revoked')
      // قراءة فاشلة لا تعني «سليم» — نوقف بدل عرض شارة خاطئة
      if (!revokedRaw.ok) throw new Error(`تعذر قراءة قائمة الحرق: ${revokedRaw.error ?? ''}`)
      let revoked = false
      try {
        const list = revokedRaw.value ? JSON.parse(revokedRaw.value) as unknown : []
        revoked = Array.isArray(list) && list.includes(fp)
      } catch { revoked = false }
      // السجل نفسه يحمل علامة الحرق أيضاً (تُكتب عند الحرق) — أيّ منهما يكفي
      try { if ((JSON.parse(rec.value) as { revoked?: unknown }).revoked) revoked = true } catch { /* سجل غير مفهوم */ }
      setResult({ raw: rec.value, fingerprint: fp, revoked })
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    setBusy(false)
  }

  async function burn() {
    if (!result) return
    setBusy(true)
    try {
      const { notes } = await revokeLicense(result.fingerprint)
      setResult({ ...result, revoked: true })
      toast('🔥 تم حرق المفتاح — لن يعمل عند العميل بعد المزامنة', 'ok')
      for (const n of notes) toast(n, 'info')
      void refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    setBusy(false)
  }

  let parsed: { payload?: { customer?: string; plan?: string; deviceId?: string; expiresAt?: string | null; issuedAt?: string; features?: string[]; extraModules?: string[]; activityId?: string }; key?: string; note?: string } | null = null
  try { parsed = result ? JSON.parse(result.raw) : null } catch { parsed = null }

  return (
    <>
      <div className="card" style={{ marginBlockEnd: 14 }}>
        <div className="row">
          <input className="input input-mono" style={{ flex: 1 }} dir="ltr" placeholder="SHOP-XXXX-XXXX-XXXX أو مفتاح كامل أو بصمة 8 خانات"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          <Btn kind="primary" onClick={() => void search()} disabled={busy || !query.trim()}>{busy ? '…' : 'بحث'}</Btn>
        </div>
      </div>

      {!result ? (
        <div className="card"><EmptyState icon="🔍" text="ابحث بمفتاح أو بصمة" hint="بمعرّف الجهاز أو المفتاح الكامل أو البصمة" /></div>
      ) : (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBlockEnd: 10 }}>
            <div className="card-title" style={{ margin: 0 }}>
              {parsed?.payload?.customer ?? 'سجل غير مفهوم'} — {PLAN_LABELS_AR[parsed?.payload?.plan as LicensePlan] ?? parsed?.payload?.plan ?? ''}
            </div>
            <div className="row">
              {result.revoked ? <Badge kind="danger">🔥 محروق</Badge> : <Badge kind="ok">✅ سليم</Badge>}
              <Badge kind="muted"><span className="mono">{result.fingerprint}</span></Badge>
            </div>
          </div>
          <ul className="plain" style={{ fontSize: 13.5 }}>
            <li>الجهاز: <span className="mono">{parsed?.payload?.deviceId ?? '—'}</span></li>
            <li>النشاط: {parsed?.payload?.activityId ? activityDisplay(parsed.payload.activityId) : 'أي نشاط'}</li>
            <li>صدر: <span className="mono">{parsed?.payload?.issuedAt ?? '—'}</span> · ينتهي: <span className="mono">{parsed?.payload?.expiresAt ?? 'مدى الحياة'}</span></li>
            <li>الميزات: {(parsed?.payload?.features ?? []).map((f) => FEATURE_LABELS_AR[f as LicenseFeature] ?? f).join('، ') || 'لا شيء'}</li>
            <li>أقسام: {(parsed?.payload?.extraModules ?? []).map((m) => MODULE_LABELS_AR[m] ?? m).join('، ') || 'لا شيء'}</li>
          </ul>
          <div className="hr" />
          <div className="muted" style={{ fontSize: 12, marginBlockEnd: 6 }}>المفتاح:</div>
          <div className="card" style={{ marginBlockEnd: 10 }}><span className="mono" style={{ wordBreak: 'break-all' }}>{parsed?.key ?? '—'}</span></div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Btn onClick={() => void copyKey(parsed?.key)}>نسخ المفتاح</Btn>
            {!result.revoked ? <Btn kind="danger" disabled={busy} onClick={() => void burn()}>🔥 حرق المفتاح</Btn> : null}
          </div>
        </div>
      )}
    </>
  )
}
