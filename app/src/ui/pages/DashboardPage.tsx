import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, BellRing } from 'lucide-react'
import { useDataStore } from '../../stores/data.store.ts'
import { expiringFirst, STATUS_LABELS_AR } from '../../core/customers.ts'
import { PLAN_LABELS_AR, type LicensePlan } from '../../core/license.ts'
import { Badge, EmptyState } from '../components/ui.tsx'
import { isDesktop } from '../../data/bridge.ts'

export function DashboardPage() {
  const navigate = useNavigate()
  const { customers, error } = useDataStore()

  const kpis = useMemo(() => {
    const active = customers.filter((c) => c.status === 'active').length
    const expiring = customers.filter((c) => c.status === 'expiring').length
    const expired = customers.filter((c) => c.status === 'expired').length
    const revoked = customers.filter((c) => c.status === 'revoked').length
    const support = customers.filter((c) => c.lastSupportAt).length
    return { total: customers.length, active, expiring, expired, revoked, support }
  }, [customers])

  const recent = useMemo(
    // lastSeenAt بصيغة ISO وlastActivityAt بصيغة «YYYY-MM-DD HH:MM» — نوحّدهما قبل المقارنة
    () => [...customers].sort((a, b) => seenKey(b).localeCompare(seenKey(a))).slice(0, 8),
    [customers],
  )

  const expiringSoon = useMemo(
    () => expiringFirst(customers, 8),
    [customers],
  )

  return (
    <>
      {!isDesktop() ? (
        <div className="card" style={{ marginBlockEnd: 14, borderColor: 'var(--warn)' }}>
          ⚠️ أنت تشغّل الواجهة في المتصفح — قراءة/كتابة Cloudflare وإرسال تليجرام وتوقيع المفاتيح تعمل داخل
          <b> تطبيق سطح المكتب</b> فقط (npm run desktop:dev).
        </div>
      ) : null}
      {error ? <div className="card" style={{ marginBlockEnd: 14, borderColor: 'var(--danger)' }}>❌ {error}</div> : null}

      <div className="kpi-grid" style={{ marginBlockEnd: 16 }}>
        <div className="kpi"><div className="kpi-value">{kpis.total}</div><div className="kpi-label">إجمالي العملاء</div></div>
        <div className="kpi"><div className="kpi-value" style={{ color: 'var(--ok)' }}>{kpis.active}</div><div className="kpi-label">اشتراك نشط</div></div>
        <div className="kpi"><div className="kpi-value" style={{ color: 'var(--warn)' }}>{kpis.expiring}</div><div className="kpi-label">قرب الانتهاء (٧ أيام)</div></div>
        <div className="kpi"><div className="kpi-value" style={{ color: 'var(--danger)' }}>{kpis.expired}</div><div className="kpi-label">منتهٍ</div></div>
        <div className="kpi"><div className="kpi-value" style={{ color: 'var(--danger)' }}>{kpis.revoked}</div><div className="kpi-label">محروق</div></div>
        <div className="kpi"><div className="kpi-value" style={{ color: 'var(--accent-2)' }}>{kpis.support}</div><div className="kpi-label">عملاء راسلوا الدعم</div></div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-title">🕘 آخر ظهور للعملاء</div>
          {recent.length === 0 ? (
            <EmptyState icon="👥" text="لا يوجد عملاء بعد" hint="ابدأ بإصدار مفتاح من صفحة «إصدار المفاتيح»" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>العميل</th><th>الباقة</th><th>الحالة</th><th>آخر ظهور</th></tr>
                </thead>
                <tbody>
                  {recent.map((c) => (
                    <tr key={c.deviceId} className="clickable" onClick={() => navigate(`/customers?focus=${c.deviceId}`)}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{c.customer || '—'}</div>
                        <div className="mono muted">{c.deviceId}</div>
                      </td>
                      <td>{PLAN_LABELS_AR[c.plan as LicensePlan] ?? c.plan ?? '—'}</td>
                      <td><StatusBadge status={c.status} /></td>
                      <td className="muted">{seenKey(c) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">⏰ تحتاج انتباهك</div>
          {expiringSoon.length === 0 ? (
            <EmptyState icon="✅" text="لا اشتراكات منتهية أو موشكة على الانتهاء" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>العميل</th><th>ينتهي</th><th>الحالة</th></tr></thead>
                <tbody>
                  {expiringSoon.map((c) => (
                    <tr key={c.deviceId} className="clickable" onClick={() => navigate(`/customers?focus=${c.deviceId}`)}>
                      <td>{c.customer || c.deviceId}</td>
                      <td className="mono">{c.expiresAt ?? 'مدى الحياة'}</td>
                      <td><StatusBadge status={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="hr" />
          <div className="row">
            <button className="btn btn-sm" onClick={() => navigate('/licenses')}><KeyRound size={14} /> إصدار مفتاح</button>
            <button className="btn btn-sm" onClick={() => navigate('/notifications')}><BellRing size={14} /> إرسال إشعار</button>
          </div>
        </div>
      </div>

    </>
  )
}

function seenKey(c: { lastSeenAt: string | null; lastActivityAt: string | null }): string {
  return (c.lastSeenAt ?? c.lastActivityAt ?? '').slice(0, 16).replace('T', ' ')
}

export function StatusBadge({ status }: { status: keyof typeof STATUS_LABELS_AR }) {
  const kind = status === 'active' ? 'ok' : status === 'expiring' ? 'warn' : status === 'expired' || status === 'revoked' ? 'danger' : 'muted'
  return <Badge kind={kind}>{STATUS_LABELS_AR[status]}</Badge>
}
