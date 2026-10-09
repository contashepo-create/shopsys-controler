import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { bridge } from '../../data/bridge.ts'
import { useDataStore } from '../../stores/data.store.ts'
import { updateAbout, updateVersion } from '../../data/actions.ts'
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

  const [busy, setBusy] = useState(false)
  // قراءة فاشلة لأي من القسمين = نموذج فارغ؛ حفظه كان سيمسح المحتوى الحقيقي عند كل العملاء
  const [aboutLoad, setAboutLoad] = useState<'loading' | 'ok' | string>('loading')
  const [versionLoad, setVersionLoad] = useState<'loading' | 'ok' | string>('loading')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setAboutLoad('loading'); setVersionLoad('loading')
    void (async () => {
      let about: Awaited<ReturnType<typeof bridge.cf.get>>
      let ver: Awaited<ReturnType<typeof bridge.cf.get>>
      try {
        [about, ver] = await Promise.all([
          bridge.cf.get('services', 'about'),
          bridge.cf.get('services', 'version'),
        ])
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        setAboutLoad(msg); setVersionLoad(msg)
        return
      }
      if (cancelled) return
      setAboutLoad(about.ok ? 'ok' : (about.error ?? 'تعذر القراءة'))
      setVersionLoad(ver.ok ? 'ok' : (ver.error ?? 'تعذر القراءة'))
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
    })()
    return () => { cancelled = true }
  }, [reload])

  const loadBanner = (state: string, what: string) => state === 'ok' || state === 'loading' ? null : (
    <div style={{ color: 'var(--danger)', fontSize: 12.5, marginBlockEnd: 8 }}>
      ⚠️ تعذر قراءة {what} الحالي — {state}. الحفظ معطّل حتى لا يُكتب نموذج فارغ فوقه.{' '}
      <Btn size="sm" onClick={() => setReload((n) => n + 1)}>إعادة المحاولة</Btn>
    </div>
  )

  async function saveAbout() {
    if (aboutLoad !== 'ok') { toast('لم تُقرأ «حول» الحالية بعد — أعد المحاولة أولاً', 'error'); return }
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
    if (versionLoad !== 'ok') { toast('لم تُقرأ بيانات التحديث الحالية بعد — أعد المحاولة أولاً', 'error'); return }
    if (!/^\d+\.\d+\.\d+$/.test(version.trim())) { toast('صيغة النسخة يجب أن تكون x.y.z', 'error'); return }
    setBusy(true)
    try {
      await updateVersion({ latestVersion: version.trim(), downloadUrl, sha256, mandatory, releaseNotesAr: releaseNotes })
      setCurrentVersion(version.trim())
      toast('تم نشر التحديث — يظهر للعملاء في «فحص التحديثات»', 'ok')
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="card">
        <div className="card-title">📄 محتوى «حول» (يظهر لكل العملاء)</div>
        {loadBanner(aboutLoad, 'محتوى «حول»')}
        <Field label="العنوان" value={aboutTitle} onChange={setAboutTitle} />
        <Textarea label="النص" value={aboutBody} onChange={setAboutBody} rows={5} />
        <div className="grid-2">
          <Field label="هاتف الدعم" value={aboutPhone} onChange={setAboutPhone} dir="ltr" />
          <Field label="تيليجرام الدعم" value={aboutTelegram} onChange={setAboutTelegram} dir="ltr" />
        </div>
        <Field label="الموقع" value={aboutWebsite} onChange={setAboutWebsite} dir="ltr" />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Btn kind="primary" disabled={busy || aboutLoad !== 'ok'} onClick={() => void saveAbout()}>حفظ في الاسمين</Btn>
        </div>
      </div>

      <div className="card">
        <div className="card-title">⬆️ نشر تحديث التطبيق <Badge kind="muted">الحالي: {currentVersion ?? '—'}</Badge></div>
        {!servicesAvailable ? (
          <div className="notice notice-warn" style={{ display: 'block' }}>
            نقطة <span className="mono">/version</span> تُقرأ من مساحة الخدمات <span className="mono">SHOPSYS_KV</span> وهي غير مضبوطة.
            <div style={{ marginBlockStart: 8 }}><Link className="btn btn-sm" to="/settings">اضبطها من الإعدادات</Link></div>
          </div>
        ) : loadBanner(versionLoad, 'إعلان التحديث')}
        <Field label="النسخة الجديدة (x.y.z)" value={version} onChange={setVersion} dir="ltr" placeholder="1.0.20" />
        <Field label="رابط التنزيل" value={downloadUrl} onChange={setDownloadUrl} dir="ltr" />
        <Field label="SHA-256" value={sha256} onChange={setSha256} mono />
        <Textarea label="ملاحظات الإصدار" value={releaseNotes} onChange={setReleaseNotes} rows={3} />
        <label className="check-row">
          <input type="checkbox" checked={mandatory} onChange={() => setMandatory(!mandatory)} />
          <span>تحديث إجباري</span>
        </label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Btn kind="primary" disabled={busy || !servicesAvailable || versionLoad !== 'ok'} onClick={() => void saveVersion()}>نشر التحديث</Btn>
        </div>
      </div>

    </div>
  )
}

