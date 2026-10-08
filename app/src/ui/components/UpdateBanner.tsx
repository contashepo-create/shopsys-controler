import { useEffect, useState } from 'react'
import { Download, RefreshCw, Rocket, X } from 'lucide-react'
import { useUpdatesStore } from '../../stores/updates.store.ts'
import { Btn, useToast } from './ui.tsx'

/**
 * شريط التحديث — سلوك العملية الرئيسية: التنزيل في الخلفية تلقائياً، والتثبيت عند إغلاق اللوحة.
 * لا يظهر الشريط إلا عند وجود ما يهمّ المالك: إصدار جديد / تنزيل جارٍ / تحديث جاهز / خطأ.
 * (حالة «أنت على أحدث إصدار» تظهر 6 ثوانٍ ثم تختفي، و«جارٍ الفحص» لا تُزعج عند الإقلاع.)
 */
export function UpdateBanner() {
  const toast = useToast()
  const { state, init, check, download, install, busy } = useUpdatesStore()
  const [hiddenFor, setHiddenFor] = useState<string | null>(null)

  useEffect(() => { init() }, [init])

  const status = state?.status
  const version = state?.version ?? null

  // «أنت على أحدث إصدار» إشعار عابر — يُخفى وحده بعد ثوانٍ
  useEffect(() => {
    if (status !== 'latest') return
    const t = setTimeout(() => setHiddenFor(`latest:${version ?? ''}`), 6000)
    return () => clearTimeout(t)
  }, [status, version])

  if (!state) return null
  const { percent, error, currentVersion } = state

  if (status === 'idle' || status === 'checking' || status === 'unsupported') return null

  const key = `${status}:${version ?? ''}`
  if (hiddenFor === key) return null
  const hide = () => setHiddenFor(key)

  if (status === 'latest') {
    return (
      <div className="notice notice-ok">
        <span>✅ أنت على أحدث إصدار ({currentVersion})</span>
        <Btn size="sm" kind="ghost" onClick={hide}><X size={14} /></Btn>
      </div>
    )
  }

  if (status === 'available') {
    return (
      <div className="notice notice-warn">
        <span>
          🚀 <b>إصدار جديد: {version}</b> — إصدارك الحالي {currentVersion}. يبدأ التنزيل في الخلفية تلقائياً.
        </span>
        <div className="row">
          <Btn size="sm" kind="primary" onClick={() => { void download().then((r) => { if (!r.ok) toast(r.error ?? 'تعذر التنزيل', 'error') }) }}>
            <Download size={14} /> تنزيل الآن
          </Btn>
          <Btn size="sm" kind="ghost" onClick={hide} title="إخفاء الشريط (التنزيل يستمر)"><X size={14} /></Btn>
        </div>
      </div>
    )
  }

  if (status === 'downloading') {
    return (
      <div className="notice notice-warn" style={{ display: 'block' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>⬇️ يُنزَّل التحديث {version ? `(${version})` : ''} في الخلفية — سيُثبَّت عند إغلاق اللوحة.</span>
          <div className="row">
            <b>{percent}%</b>
            <Btn size="sm" kind="ghost" onClick={hide} title="إخفاء الشريط (التنزيل يستمر)"><X size={14} /></Btn>
          </div>
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
        <span>
          🎉 <b>التحديث {version} جاهز</b> — سيُثبَّت تلقائياً عند إغلاق اللوحة. بياناتك ومفاتيحك تبقى كما هي.
        </span>
        <div className="row">
          <Btn size="sm" kind="primary" onClick={() => { void install().then((r) => { if (!r.ok) toast(r.error ?? 'تعذر التثبيت', 'error') }) }}>
            <Rocket size={14} /> إعادة التشغيل والتثبيت الآن
          </Btn>
          <Btn size="sm" kind="ghost" onClick={hide} title="إخفاء الشريط (التثبيت عند الإغلاق يبقى)"><X size={14} /></Btn>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="notice notice-danger">
        <span>⚠️ تعذر التحديث: {error ?? 'خطأ غير معروف'} — سيُعاد الفحص تلقائياً.</span>
        <Btn size="sm" onClick={() => { void check().then((r) => { if (!r.ok) toast(r.error ?? 'تعذر الفحص', 'error') }) }} disabled={busy}>
          <RefreshCw size={14} /> إعادة المحاولة
        </Btn>
      </div>
    )
  }

  return null
}
