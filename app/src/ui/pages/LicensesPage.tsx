import { useEffect, useMemo, useState } from 'react'
import { bridge } from '../../data/bridge.ts'
import { issueLicense, revokeLicense, previewPayload } from '../../data/actions.ts'
import { useDataStore } from '../../stores/data.store.ts'
import {
  DEVICE_ID_RE, generateDeviceId, keyFingerprint,
  LICENSE_FEATURES, FEATURE_LABELS_AR, MODULE_LABELS_AR, EXTRA_MODULES,
  PLAN_LABELS_AR, PLAN_LIMITS, canonicalPayload, type LicensePlan, type LicenseFeature,
} from '../../core/license.ts'
import { Btn, Field, Select, useToast, Badge, EmptyState } from '../components/ui.tsx'
import { LicenseKeyResult } from '../components/LicenseKeyResult.tsx'
import { ActivityPicker, isActivityValueValid } from '../components/ActivityPicker.tsx'
import { activityDisplay, resolveClientActivity } from '../../core/activities.ts'

type Tab = 'issue' | 'search'

export function LicensesPage() {
  const [tab, setTab] = useState<Tab>('issue')
  return (
    <>
      <div className="row" style={{ marginBlockEnd: 14 }}>
        <Btn kind={tab === 'issue' ? 'primary' : 'default'} onClick={() => setTab('issue')}>🔑 إصدار مفتاح</Btn>
        <Btn kind={tab === 'search' ? 'primary' : 'default'} onClick={() => setTab('search')}>🔍 بحث / حرج</Btn>
      </div>
      {tab === 'issue' ? <IssueTab /> : <SearchTab />}
    </>
  )
}

const PLAN_OPTIONS = (Object.keys(PLAN_LABELS_AR) as LicensePlan[]).map((p) => ({ value: p, label: `${PLAN_LABELS_AR[p]} (${p})` }))

function IssueTab() {
  const toast = useToast()
  const refresh = useDataStore((s) => s.refresh)
  const customers = useDataStore((s) => s.customers)
  const [deviceId, setDeviceId] = useState('')
  const [customer, setCustomer] = useState('')
  const [plan, setPlan] = useState<LicensePlan>('basic')
  const [days, setDays] = useState('365')
  const [activityId, setActivityId] = useState('')
  const [activityCustom, setActivityCustom] = useState(false)
  /** غيّر المطوّر النشاط يدوياً؟ عندها لا نكتب فوق اختياره */
  const [activityTouched, setActivityTouched] = useState(false)
  const [extraUsers, setExtraUsers] = useState('')
  const [extraBranches, setExtraBranches] = useState('')
  const [features, setFeatures] = useState<LicenseFeature[]>([])
  const [modules, setModules] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<{ key: string; fingerprint: string } | null>(null)

  const deviceValid = DEVICE_ID_RE.test(deviceId.trim().toUpperCase())

  // عميل موجود بنفس معرّف الجهاز؟ → نكتب نشاطه تلقائياً كما اختاره (ويبقى قابلاً للتغيير)
  const existing = useMemo(
    () => (deviceValid ? customers.find((c) => c.deviceId === deviceId.trim().toUpperCase()) ?? null : null),
    [customers, deviceId, deviceValid],
  )
  const autoActivity = useMemo(() => (existing ? resolveClientActivity(existing) : { id: '', source: 'none' as const }), [existing])
  useEffect(() => {
    if (activityTouched) return
    setActivityId(autoActivity.id)
    setActivityCustom(false)
  }, [autoActivity, activityTouched])
  useEffect(() => {
    if (existing && !customer.trim() && existing.customer) setCustomer(existing.customer)
    // اسم العميل يُعبّأ مرة عند التعرف على الجهاز فقط
  }, [existing])

  function newDeviceId() {
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    setDeviceId(generateDeviceId(bytes))
  }

  const toggle = <T,>(list: T[], set: (v: T[]) => void, v: T) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  async function submit() {
    if (!deviceValid) { toast('معرّف الجهاز غير صحيح — الصيغة SHOP-XXXX-XXXX-XXXX', 'error'); return }
    if (!customer.trim()) { toast('اسم العميل مطلوب', 'error'); return }
    if (!isActivityValueValid(activityId)) { toast('معرّف النشاط غير صالح', 'error'); return }
    setBusy(true)
    try {
      const res = await issueLicense({
        deviceId: deviceId.trim().toUpperCase(),
        customer: customer.trim(),
        plan,
        days: Number(days) || 365,
        activityId: activityId.trim() || undefined,
        extraUsers: Number(extraUsers) || 0,
        extraBranches: Number(extraBranches) || 0,
        features,
        extraModules: modules,
      })
      setIssued({ key: res.key, fingerprint: res.fingerprint })
      if (res.notes?.length) toast(res.notes[0], 'info')
      else toast('تم إصدار المفتاح ورفعه إلى Cloudflare ✓', 'ok')
      await refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    setBusy(false)
  }

  async function copyPayload() {
    const p = previewPayload({
      deviceId: deviceId.trim().toUpperCase(), customer, plan, days: Number(days) || 365,
      activityId: activityId.trim() || undefined, extraUsers: Number(extraUsers) || 0, extraBranches: Number(extraBranches) || 0,
      features, extraModules: modules,
    })
    await navigator.clipboard.writeText(canonicalPayload(p))
    toast('تم نسخ الحمولة القياسية (للمقارنة مع البوت)', 'ok')
  }

  if (issued) {
    return (
      <div className="card">
        <div className="card-title">✅ مفتاح التفعيل جاهز</div>
        <LicenseKeyResult licenseKey={issued.key} fingerprint={issued.fingerprint} onCopy={() => toast('تم النسخ ✓', 'ok')} />
        <div className="hr" />
        <div className="row">
          <Btn onClick={() => { setIssued(null); setCustomer(''); setDeviceId(''); setFeatures([]); setModules([]); setActivityId(''); setActivityCustom(false); setActivityTouched(false) }}>إصدار مفتاح آخر</Btn>
          <Btn onClick={() => void copyPayload()}>نسخ الحمولة القياسية</Btn>
        </div>
      </div>
    )
  }

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="card">
        <div className="card-title">بيانات الاشتراك</div>
        <div className="field">
          <label>معرّف الجهاز *</label>
          <div className="row">
            <input className="input input-mono" style={{ flex: 1 }} value={deviceId} dir="ltr" placeholder="SHOP-XXXX-XXXX-XXXX"
              onChange={(e) => setDeviceId(e.target.value.toUpperCase())} />
            <Btn size="sm" onClick={newDeviceId} title="توليد معرّف جهاز جديد (لاختبار أو استبدال)">🎲</Btn>
          </div>
          <span className="hint">
            {!deviceValid ? 'يظهر للعميل في شاشة التفعيل داخل التطبيق'
              : existing ? `✓ عميل مسجَّل: ${existing.customer || '—'}${existing.clientActivityId ? ` · نشاطه: ${activityDisplay(existing.clientActivityId)}` : ''}`
              : '✓ صيغة صحيحة — جهاز جديد'}
          </span>
        </div>
        <Field label="اسم العميل *" value={customer} onChange={setCustomer} placeholder="بقالة النور — المنصورة" />
        <div className="grid-2">
          <Select label="الخطة" value={plan} onChange={(v) => setPlan(v as LicensePlan)} options={PLAN_OPTIONS} />
          <Field label="المدة (أيام)" value={days} onChange={setDays} dir="ltr" hint={plan === 'lifetime' ? 'تُهمل مع «مدى الحياة»' : `الحدود: ${PLAN_LIMITS[plan].maxUsers} مستخدم / ${PLAN_LIMITS[plan].maxBranches} فرع`} />
        </div>
        <ActivityPicker
          value={activityId}
          onChange={(v) => { setActivityId(v); setActivityTouched(true) }}
          clientActivityId={existing?.clientActivityId}
          source={autoActivity.source}
          custom={activityCustom}
          onCustomChange={(v) => { setActivityCustom(v); setActivityTouched(true) }}
        />
        <div className="grid-2">
          <Field label="+ مستخدمون" value={extraUsers} onChange={setExtraUsers} dir="ltr" />
          <Field label="+ فروع" value={extraBranches} onChange={setExtraBranches} dir="ltr" />
        </div>
      </div>

      <div className="card">
        <div className="card-title">الميزات والأقسام</div>
        {LICENSE_FEATURES.map((f) => (
          <label key={f} className="check-row">
            <input type="checkbox" checked={features.includes(f)} onChange={() => toggle(features, setFeatures, f)} />
            <span>{FEATURE_LABELS_AR[f]}<span className="check-desc"> — {f}</span></span>
          </label>
        ))}
        <div className="section-title">أقسام إضافية</div>
        {EXTRA_MODULES.map((m) => (
          <label key={m} className="check-row">
            <input type="checkbox" checked={modules.includes(m)} onChange={() => toggle(modules, setModules, m)} />
            <span>{MODULE_LABELS_AR[m] ?? m}<span className="check-desc"> — {m}</span></span>
          </label>
        ))}
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="muted" style={{ fontSize: 12.5 }}>
            يُوقَّع المفتاح <b>محلياً</b> على جهازك (Ed25519)، ثم يُرفع السجل إلى Cloudflare KV — نفس تنسيق البوت حرفياً.
          </div>
          <div className="row">
            <Btn onClick={() => void copyPayload()}>نسخ الحمولة القياسية</Btn>
            <Btn kind="primary" disabled={busy || !deviceValid || !customer.trim()} onClick={() => void submit()}>
              {busy ? 'جارٍ التوقيع والرفع…' : 'إصدار المفتاح'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

function SearchTab() {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ raw: string; fingerprint: string; revoked: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  async function search() {
    const q = query.trim()
    if (!q) return
    setBusy(true)
    try {
      const fp = /^[0-9a-f]{8}$/i.test(q) ? q.toLowerCase() : keyFingerprint(q)
      const rec = await bridge.cf.get('license', `lic:${fp}`)
      if (!rec.ok) throw new Error(rec.error ?? 'تعذر القراءة')
      if (!rec.value) { setResult(null); toast(`لا سجل للبصمة ${fp}`, 'error'); setBusy(false); return }
      const revokedRaw = await bridge.cf.get('license', 'revoked')
      let revoked = false
      try {
        const list = revokedRaw.ok && revokedRaw.value ? JSON.parse(revokedRaw.value) as string[] : []
        revoked = Array.isArray(list) && list.includes(fp)
      } catch { revoked = false }
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
      await revokeLicense(result.fingerprint)
      setResult({ ...result, revoked: true })
      toast('🔥 تم حرق المفتاح في الاسمين — لن يعمل عند العميل بعد المزامنة', 'ok')
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
        <div className="card"><EmptyState icon="🔍" text="ابحث بمفتاح أو بصمة" hint="نفس أوامر /بحث و/حرق في البوت — على نفس البيانات" /></div>
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
            <Btn onClick={() => { if (parsed?.key) { void navigator.clipboard.writeText(parsed.key); toast('تم نسخ المفتاح ✓', 'ok') } }}>نسخ المفتاح</Btn>
            {!result.revoked ? <Btn kind="danger" disabled={busy} onClick={() => void burn()}>🔥 حرق المفتاح</Btn> : null}
          </div>
        </div>
      )}
    </>
  )
}
