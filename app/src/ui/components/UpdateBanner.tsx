import { useEffect } from 'react'
import { Download, RefreshCw, Rocket, X } from 'lucide-react'
import { useUpdatesStore } from '../../stores/updates.store.ts'
import { Btn, useToast } from './ui.tsx'

/**
 * شريط التحديث — يظهر فقط عند وجود إصدار جديد أو أثناء التنزيل أو عند الاستعداد.
 * الفحص يبدأ تلقائياً في العملية الرئيسية بعد الإقلاع؛ وهنا نعرض النتيجة ونتيح الإجراء.
 */
export function UpdateBanner() {
  const toast = useToast()
  const { state, init, check, download, install, busy } = useUpdatesStore()

  useEffect(() => { init() }, [init])

  if (!state) return null
  const { status, version, percent, error } = state

  if (status === 'idle') return null

  if (status === 'checking') {
    return (
      <div className="notice">
        <span>🔄 جارٍ فحص التحديثات…</span>
        <Btn size="sm" disabled>فحص</Btn>
      </div>
    )
  }

  if (status === 'latest') {
    return (
      <div className="notice notice-ok">
        <span>✅ أنت على أحدث إصدار ({state.currentVersion})</span>
        <Btn size="sm" kind="ghost" onClick={() => { void check().then((r) => { if (!r.ok) toast(r.error ?? 'تعذر الفحص', 'error') }) }}>إخفاء</Btn>
      </div>
    )
  }

  if (status === 'available') {
    return (
      <div className="notice notice-warn">
        <span>
          🚀 <b>يوجد إصدار جديد: {version}</b> — إصدارك الحالي {state.currentVersion}.
          التنزيل ~110 ميجابايت.
        </span>
        <div className="row">
          <Btn size="sm" kind="primary" onClick={() => { void download().then((r) => { if (!r.ok) toast(r.error ?? 'تعذر التنزيل', 'error') }) }}>
            <Download size={14} /> تنزيل التحديث
          </Btn>
          <Btn size="sm" kind="ghost" onClick={() => toast('سيُذكَّرك عند الفحص القادم', 'info')}><X size={14} /></Btn>
        </div>
      </div>
    )
  }

  if (status === 'downloading') {
    return (
      <div className="notice notice-warn" style={{ display: 'block' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>⬇️ جارٍ تنزيل التحديث {version ? `(${version})` : ''}…</span>
          <b>{percent}%</b>
        </div>
        <div style={{ marginBlockStart: 8, blockSize: 8, borderRadius: 999, background: 'var(--bg-soft)', overflow: 'hidden' }}>
          <div style={{ inlineSize: `${Math.max(2, percent)}%`, blockSize: '100%', background: 'var(--accent)', transition: 'inline-size .3s' }} />
        </div>
      </div>
    )
  }

  if (status === 'ready') {
    return (
      <div className="notice notice-ok">
        <span>🎉 <b>التحديث {version} جاهز</b> — أعد تشغيل اللوحة لإتمام التثبيت.</span>
        <Btn size="sm" kind="primary" onClick={() => { void install().then((r) => { if (!r.ok) toast(r.error ?? 'تعذر التثبيت', 'error') }) }}>
          <Rocket size={14} /> إعادة التشغيل والتثبيت
        </Btn>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="notice notice-danger">
        <span>⚠️ تعذر التحديث: {error ?? 'خطأ غير معروف'}</span>
        <Btn size="sm" onClick={() => { void check().then((r) => { if (!r.ok) toast(r.error ?? 'تعذر الفحص', 'error') }) }} disabled={busy}>
          <RefreshCw size={14} /> إعادة المحاولة
        </Btn>
      </div>
    )
  }

  return null
}
