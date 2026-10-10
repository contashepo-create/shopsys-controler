import { useEffect, useState } from 'react'
import { bridge } from '../../data/bridge.ts'
import { updateAbout } from '../../data/actions.ts'
import { parseAboutDoc, type AboutDoc } from '../../core/about.ts'
import { Btn, Field, Textarea, useToast } from '../components/ui.tsx'

/**
 * «حول» — المحتوى الذي يراه كل العملاء.
 * ⚠️ المستند يشترك فيه البوت (مطوّر الشركة): حقول واتساب والبريد والعنوان وساعات العمل
 * والروابط والحقول الإضافية يكتبها البوت. اللوحة تحمّل المستند كاملاً وتعيد كتابته كاملاً
 * بتعديل الحقول الخمسة التي تحررها فقط — وإلا مُسحت هذه الحقول عند كل حفظ.
 */
export function ContentPage() {
  const toast = useToast()
  const [doc, setDoc] = useState<AboutDoc | null>(null)
  const [aboutTitle, setAboutTitle] = useState('')
  const [aboutBody, setAboutBody] = useState('')
  const [aboutPhone, setAboutPhone] = useState('')
  const [aboutTelegram, setAboutTelegram] = useState('')
  const [aboutWebsite, setAboutWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  // قراءة فاشلة = نموذج فارغ؛ حفظه كان سيمسح المحتوى الحقيقي عند كل العملاء
  const [aboutLoad, setAboutLoad] = useState<'loading' | 'ok' | string>('loading')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setAboutLoad('loading')
    void (async () => {
      let about: Awaited<ReturnType<typeof bridge.cf.get>>
      try {
        about = await bridge.cf.get('services', 'about')
      } catch (e) {
        if (cancelled) return
        setAboutLoad(e instanceof Error ? e.message : String(e))
        return
      }
      if (cancelled) return
      if (!about.ok) { setAboutLoad(about.error ?? 'تعذر القراءة'); return }
      const parsed = parseAboutDoc(about.value)
      setDoc(parsed)
      setAboutTitle(parsed.title); setAboutBody(parsed.body)
      setAboutPhone(parsed.supportPhone); setAboutTelegram(parsed.supportTelegram); setAboutWebsite(parsed.website)
      setAboutLoad('ok')
    })()
    return () => { cancelled = true }
  }, [reload])

  async function saveAbout() {
    if (aboutLoad !== 'ok' || !doc) { toast('لم تُقرأ «حول» الحالية بعد — أعد المحاولة أولاً', 'error'); return }
    setBusy(true)
    try {
      // المستند الكامل (بما فيه حقول البوت) + تعديل الحقول الخمسة فقط
      await updateAbout({
        ...doc,
        title: aboutTitle.trim() || 'TAHAKAM ERP — تَحَكَّم في إدارة أعمالك',
        body: aboutBody, supportPhone: aboutPhone, supportTelegram: aboutTelegram, website: aboutWebsite,
      })
      setDoc({ ...doc, title: aboutTitle.trim(), body: aboutBody, supportPhone: aboutPhone, supportTelegram: aboutTelegram, website: aboutWebsite })
      toast('تم تحديث «حول» في الاسمين ✓', 'ok')
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error') }
    setBusy(false)
  }

  const preserved = doc
    ? [
        doc.supportWhatsapp && `واتساب: ${doc.supportWhatsapp}`,
        doc.supportEmail && `البريد: ${doc.supportEmail}`,
        doc.address && `العنوان: ${doc.address}`,
        doc.workHours && `مواعيد العمل: ${doc.workHours}`,
        doc.socialLinks.length > 0 && `روابط التواصل: ${doc.socialLinks.length}`,
        doc.extraFields.length > 0 && `حقول إضافية: ${doc.extraFields.length}`,
      ].filter(Boolean) as string[]
    : []

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="card">
        <div className="card-title">📄 محتوى «حول» (يظهر لكل العملاء)</div>
        {aboutLoad === 'ok' || aboutLoad === 'loading' ? null : (
          <div style={{ color: 'var(--danger)', fontSize: 12.5, marginBlockEnd: 8 }}>
            ⚠️ تعذر قراءة محتوى «حول» الحالي — {aboutLoad}. الحفظ معطّل حتى لا يُكتب نموذج فارغ فوقه.{' '}
            <Btn size="sm" onClick={() => setReload((n) => n + 1)}>إعادة المحاولة</Btn>
          </div>
        )}
        <Field label="العنوان" value={aboutTitle} onChange={setAboutTitle} />
        <Textarea label="النص" value={aboutBody} onChange={setAboutBody} rows={5} />
        <div className="grid-2">
          <Field label="هاتف الدعم" value={aboutPhone} onChange={setAboutPhone} dir="ltr" />
          <Field label="تيليجرام الدعم" value={aboutTelegram} onChange={setAboutTelegram} dir="ltr" />
        </div>
        <Field label="الموقع" value={aboutWebsite} onChange={setAboutWebsite} dir="ltr" />
        {preserved.length > 0 ? (
          <div className="muted" style={{ fontSize: 12.5, marginBlockStart: 6 }}>
            🔒 حقول يكتبها مطوّر الشركة محفوظة ولا تُعدَّل من هنا: {preserved.join(' · ')}
          </div>
        ) : null}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Btn kind="primary" disabled={busy || aboutLoad !== 'ok'} onClick={() => void saveAbout()}>حفظ في الاسمين</Btn>
        </div>
      </div>
    </div>
  )
}
