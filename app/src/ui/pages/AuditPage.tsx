import { useEffect, useState } from 'react'
import { bridge, type AuditRow } from '../../data/bridge.ts'
import { describeAudit } from '../../core/audit.ts'
import { EmptyState, Btn, Badge } from '../components/ui.tsx'

export function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [limit, setLimit] = useState(200)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      setRows(await bridge.db.auditList(limit))
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
                  <td><Badge kind={r.action.includes('revoke') || r.action.includes('deactivate') ? 'danger' : 'accent'}>{describeAudit(r)}</Badge></td>
                  <td className="mono">{r.target ?? '—'}</td>
                  <td className="muted" style={{ maxInlineSize: 380 }}>{r.details ? JSON.stringify(r.details) : '—'}</td>
                  <td className="muted">{r.at.slice(0, 19).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
