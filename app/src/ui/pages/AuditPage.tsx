import { useEffect, useState } from 'react'
import { bridge, type AuditRow } from '../../data/bridge.ts'
import { describeAudit } from '../../core/audit.ts'
import { EmptyState, Btn, Badge } from '../components/ui.tsx'

/**
 * نسخة سطح المكتب تخزّن التفاصيل نصاً بصيغة JSON مسبقاً — إعادة JSON.stringify عليها كانت
 * تعرضها مهرّبة ("{\"plan\":…}"). النص يُعرض كما هو، والكائن (نسخة المتصفح) يُحوَّل.
 */
export function formatAuditDetails(details: unknown): string {
  if (details == null || details === '') return '—'
  if (typeof details === 'string') return details
  try { return JSON.stringify(details) } catch { return String(details) }
}

export function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [limit, setLimit] = useState(200)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const list = await bridge.db.auditList(limit)
      // قناة مرفوضة (مثلاً اللوحة مقفلة) تعيد { ok:false } وليس مصفوفة
      if (!Array.isArray(list)) throw new Error((list as { error?: string })?.error ?? 'تعذر قراءة السجل')
      setRows(list)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [limit])

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBlockEnd: 12 }}>
        <div className="card-title" style={{ margin: 0 }}>🧾 سجل التدقيق المحلي</div>
        <div className="row">
          <select className="select" style={{ inlineSize: 140 }} value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))}>
            <option value="100">آخر 100</option>
            <option value="200">آخر 200</option>
            <option value="500">آخر 500</option>
          </select>
          <Btn onClick={() => void load()} disabled={loading}>{loading ? '…' : 'تحديث'}</Btn>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginBlockEnd: 12 }}>
        يُسجَّل محلياً على جهازك فقط: مَن فعل ماذا ومتى — بلا أي مفاتيح أو توكنات (تشفير القيم الحساسة مستبعد عمداً).
      </div>
      {error ? <div className="notice notice-warn" style={{ display: 'block', marginBlockEnd: 12 }}>تعذر تحميل السجل: {error}</div> : null}
      {rows.length === 0 ? (
        <EmptyState icon="🧾" text="لا عمليات مسجلة بعد" hint="كل إصدار/حرق/إشعار/رد دعم يُسجَّل هنا" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>العملية</th><th>الهدف</th><th>تفاصيل</th><th>الوقت</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted">{r.id}</td>
                  <td><Badge kind={/revoke|deactivate/.test(String(r.action ?? '')) ? 'danger' : 'accent'}>{describeAudit(r)}</Badge></td>
                  <td className="mono">{r.target ?? '—'}</td>
                  <td className="muted" style={{ maxInlineSize: 380, overflowWrap: 'anywhere' }}>{formatAuditDetails(r.details)}</td>
                  <td className="muted">{String(r.at ?? '').slice(0, 19).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
