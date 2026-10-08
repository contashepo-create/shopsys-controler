import { useState } from 'react'
import { Btn } from './ui.tsx'

/** Shows an issued license key with copy + QR-less friendly wrapping. */
export function LicenseKeyResult(props: { licenseKey: string; fingerprint: string; onCopy?: () => void }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(props.licenseKey)
      setCopied(true)
      props.onCopy?.()
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }
  return (
    <>
      <div className="card" style={{ marginBlockEnd: 10 }}>
        <div className="muted" style={{ fontSize: 12.5, marginBlockEnd: 6 }}>مفتاح التفعيل (لا ترسله إلا للعميل صاحب الجهاز)</div>
        <div className="mono" style={{ wordBreak: 'break-all', fontSize: 12 }}>{props.licenseKey}</div>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="muted">🔑 البصمة: <span className="mono">{props.fingerprint}</span></div>
        <Btn kind="primary" onClick={() => void copy()}>{copied ? 'تم النسخ ✓' : 'نسخ المفتاح'}</Btn>
      </div>
    </>
  )
}
