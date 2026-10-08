import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { bridge } from '../../data/bridge.ts'
import { useDataStore } from '../../stores/data.store.ts'
import { updateAbout, updateVersion, updateGlobalSettings } from '../../data/actions.ts'
import { PLAN_LABELS_AR, LICENSE_FEATURES, FEATURE_LABELS_AR, EXTRA_MODULES, MODULE_LABELS_AR, type LicensePlan } from '../../core/license.ts'
import { Btn, Field, Textarea, useToast, Badge } from '../components/ui.tsx'

export function ContentPage() {
  const toast = useToast()
  const servicesAvailable = useDataStore((s) => s.servicesAvailable)
  const [aboutTitle, setAboutTitle] = useState('')
  const [aboutBody, setAboutBody] = useState('')
  const [aboutPhone, setAboutPhone] = useState('')
  const [aboutTelegram, setAboutTelegram] = useState('')
  const [aboutWebsite, setAboutWebsite] = useState('')

  const [version, setVersion] = useState('')
  const [downloadUrl, setDownloadUrl] = useState('')
  const [sha256, setSha256] = useState('')
  const [mandatory, setMandatory] = useState(false)
  const [releaseNotes, setReleaseNotes] = useState('')
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)

  const [defPlan, setDefPlan] = useState<LicensePlan>('basic')
  const [defDays, setDefDays] = useState('365')
  const [defUsers, setDefUsers] = useState('')
  const [defBranches, setDefBranches] = useState('')
  const [defFeatures, setDefFeatures] = useState<string[]>([])
  const [defModules, setDefModules] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const [about, ver, settings] = await Promise.all([
        bridge.cf.get('services', 'about'),
        bridge.cf.get('services', 'version'),
        bridge.cf.get('license', 'settings:global'),
      ])
      if (about.ok && about.value) {
        try {
          const o = JSON.parse(about.value) as Record<string, string>
          setAboutTitle(o.title ?? ''); setAboutBody(o.body ?? '')
          setAboutPhone(o.supportPhone ?? ''); setAboutTelegram(o.supportTelegram ?? ''); setAboutWebsite(o.website ?? '')
        } catch { setAboutBody(about.value) }
      }
      if (ver.ok && ver.value) {
        try {
          const o = JSON.parse(ver.value) as Record<string, unknown>
          setCurrentVersion(String(o.latestVersion ?? ''))
          setDownloadUrl(String(o.downloadUrl ?? '')); setSha256(String(o.sha256 ?? ''))
          setReleaseNotes(String(o.releaseNotesAr ?? '')); setMandatory(Boolean(o.mandatory))
        } catch { /* ignore */ }
      }
      if (settings.ok && settings.value) {
        try {
          const o = JSON.parse(settings.value) as Record<string, unknown>
          setDefPlan((o.plan as LicensePlan) ?? 'basic')
          setDefDays(String(o.days ?? 365))
          setDefUsers(o.extraUsers ? String(o.extraUsers) : '')
          setDefBranches(o.extraBranches ? String(o.extraBranches) : '')
          setDefFeatures(Array.isArray(o.features) ? o.features as string[] : [])
          setDefModules(Array.isArray(o.extraModules) ? o.extraModules as string[] : [])
        } catch { /* ignore */ }
      }
    })()
  }, [])

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  async function saveAbout() {
    setBusy(true)
    try {
      await updateAbout({
        title: aboutTitle.trim() || 'TAHAKAM ERP — تَحَكَّم في إدارة أعمالك',
        body: aboutBody, supportPhone: aboutPhone, supportTelegram: aboutTelegram, website: aboutWebsite,
      })
      toast('تم تحديث «حول» في الاسمين ✓', 'ok')
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  async function saveVersion() {
    if (!/^\d+\.\d+\.\d+$/.test(version.trim())) { toast('صيغة النسخة يجب أن تكون x.y.z', 'error'); return }
    setBusy(true)
    try {
      await updateVersion({ latestVersion: version.trim(), downloadUrl, sha256, mandatory, releaseNotesAr: releaseNotes })
      setCurrentVersion(version.trim())
      toast('تم نشر التحديث — يظهر للعملاء في «فحص التحديثات»', 'ok')
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  async function saveDefaults() {
    setBusy(true)
    try {
      await updateGlobalSettings({
        plan: defPlan, days: Number(defDays) || 365,
        features: defFeatures as never, extraUsers: Number(defUsers) || 0,
        extraBranches: Number(defBranches) || 0, extraModules: defModules,
      })
      toast('تم حفظ الإعدادات الافتراضية للرخص الجديدة ✓', 'ok')
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="card">
        <div className="card-title">📄 محتوى «حول» (يظهر لكل العملاء)</div>
        <Field label="العنوان" value={aboutTitle} onChange={setAboutTitle} />
        <Textarea label="النص" value={aboutBody} onChange={setAboutBody} rows={5} />
        <div className="grid-2">
          <Field label="هاتف الدعم" value={aboutPhone} onChange={setAboutPhone} dir="ltr" />
          <Field label="تيليجرام الدعم" value={aboutTelegram} onChange={setAboutTelegram} dir="ltr" />
        </div>
        <Field label="الموقع" value={aboutWebsite} onChange={setAboutWebsite} dir="ltr" />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Btn kind="primary" disabled={busy} onClick={() => void saveAbout()}>حفظ في الاسمين</Btn>
        </div>
      </div>

      <div className="card">
        <div className="card-title">⬆️ نشر تحديث التطبيق <Badge kind="muted">الحالي: {currentVersion ?? '—'}</Badge></div>
        {!servicesAvailable ? (
          <div className="notice notice-warn" style={{ display: 'block' }}>
            نقطة <span className="mono">/version</span> تُقرأ من مساحة الخدمات <span className="mono">SHOPSYS_KV</span> وهي غير مضبوطة.
            <div style={{ marginBlockStart: 8 }}><Link className="btn btn-sm" to="/settings">اضبطها من الإعدادات</Link></div>
          </div>
        ) : null}
        <Field label="النسخة الجديدة (x.y.z)" value={version} onChange={setVersion} dir="ltr" placeholder="1.0.20" />
        <Field label="رابط التنزيل" value={downloadUrl} onChange={setDownloadUrl} dir="ltr" />
        <Field label="SHA-256" value={sha256} onChange={setSha256} mono />
        <Textarea label="ملاحظات الإصدار" value={releaseNotes} onChange={setReleaseNotes} rows={3} />
        <label className="check-row">
          <input type="checkbox" checked={mandatory} onChange={() => setMandatory(!mandatory)} />
          <span>تحديث إجباري</span>
        </label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Btn kind="primary" disabled={busy || !servicesAvailable} onClick={() => void saveVersion()}>نشر التحديث</Btn>
        </div>
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <div className="card-title">⚙️ الإعدادات الافتراضية للرخص الجديدة (settings:global)</div>
        <div className="grid-2">
          <Field label="الخطة الافتراضية" value={defPlan} onChange={(v) => setDefPlan(v as LicensePlan)} />
          <Field label="المدة الافتراضية (أيام)" value={defDays} onChange={setDefDays} dir="ltr" />
          <Field label="+ مستخدمون" value={defUsers} onChange={setDefUsers} dir="ltr" />
          <Field label="+ فروع" value={defBranches} onChange={setDefBranches} dir="ltr" />
        </div>
        <div className="section-title">الميزات الافتراضية</div>
        <div className="row">
          {LICENSE_FEATURES.map((f) => (
            <label key={f} className="check-row" style={{ inlineSize: 'auto' }}>
              <input type="checkbox" checked={defFeatures.includes(f)} onChange={() => toggle(defFeatures, setDefFeatures, f)} />
              <span>{FEATURE_LABELS_AR[f]}</span>
            </label>
          ))}
        </div>
        <div className="section-title">الأقسام الافتراضية</div>
        <div className="row">
          {EXTRA_MODULES.map((m) => (
            <label key={m} className="check-row" style={{ inlineSize: 'auto' }}>
              <input type="checkbox" checked={defModules.includes(m)} onChange={() => toggle(defModules, setDefModules, m)} />
              <span>{MODULE_LABELS_AR[m] ?? m}</span>
            </label>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Btn kind="primary" disabled={busy} onClick={() => void saveDefaults()}>حفظ الافتراضيات</Btn>
        </div>
      </div>
    </div>
  )
}

export { PLAN_LABELS_AR }
