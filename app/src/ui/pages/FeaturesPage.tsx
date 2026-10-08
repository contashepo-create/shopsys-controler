import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDataStore } from '../../stores/data.store.ts'
import { readCloudFlags, setCloudFlag } from '../../data/actions.ts'
import { FEATURE_LABELS_AR, MODULE_LABELS_AR, LICENSE_FEATURES, type LicenseFeature } from '../../core/license.ts'
import { Btn, EmptyState, useToast, Badge } from '../components/ui.tsx'
import { IssueDialog } from './CustomersPage.tsx'

/**
 * Features & sections per customer.
 *  · granted features live inside the signed key → changing them means a NEW key
 *    (the panel does exactly what the bot's /اصدر does)
 *  · temporary cloud kill-switch (flags:<deviceId> in the services namespace) can
 *    disable a feature without a new key — same as the bot's «عطل / فعل»
 */
export function FeaturesPage() {
  const toast = useToast()
  const { customers, refresh, loading, servicesAvailable } = useDataStore()
  const [selectedId, setSelectedId] = useState<string>('')
  const [flags, setFlags] = useState<{ disabledFeatures: string[]; noteAr: string }>({ disabledFeatures: [], noteAr: '' })
  const [busy, setBusy] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  useEffect(() => { void refresh() }, [refresh])

  const selected = useMemo(() => customers.find((c) => c.deviceId === selectedId) ?? null, [customers, selectedId])

  useEffect(() => {
    if (!selected) return
    void readCloudFlags(selected.deviceId).then(setFlags)
  }, [selected])

  async function toggleFlag(f: LicenseFeature, disable: boolean) {
    if (!selected) return
    setBusy(true)
    try {
      await setCloudFlag(selected.deviceId, f, disable, disable ? 'تعطيل مؤقت من اللوحة' : '')
      setFlags(await readCloudFlags(selected.deviceId))
      toast(disable ? `🔴 أُطفئت «${FEATURE_LABELS_AR[f]}» مؤقتاً` : `🟢 أُعيد تفعيل «${FEATURE_LABELS_AR[f]}»`, 'ok')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    setBusy(false)
  }

  return (
    <>
      <div className="card" style={{ marginBlockEnd: 14 }}>
        <div className="row">
          <select className="select" style={{ flex: 1, maxInlineSize: 420 }} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">— اختر عميلاً —</option>
            {customers.map((c) => <option key={c.deviceId} value={c.deviceId}>{c.customer || c.deviceId} ({c.deviceId})</option>)}
          </select>
          <Btn onClick={() => void refresh()} disabled={loading}>تحديث القائمة</Btn>
        </div>
      </div>

      {!selected ? (
        <div className="card"><EmptyState icon="🧩" text="اختر عميلاً لعرض ميزاته وأقسامه" hint="الميزات الممنوحة تأتي من المفتاح الموقّع · الإطفاء المؤقت من السحابة" /></div>
      ) : (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="card">
            <div className="card-title">🧩 الميزات الممنوحة (داخل المفتاح)</div>
            {selected.features.length === 0 ? <span className="muted">لا ميزات ممنوحة لهذا العميل</span> : (
              <div className="row">
                {selected.features.map((f) => (
                  <Badge key={f} kind="accent">{FEATURE_LABELS_AR[f] ?? f}</Badge>
                ))}
              </div>
            )}
            <div className="section-title">الأقسام الممنوحة</div>
            {selected.extraModules.length === 0 ? <span className="muted">لا أقسام مضافة</span> : (
              <div className="row">
                {selected.extraModules.map((m) => <Badge key={m} kind="muted">{MODULE_LABELS_AR[m] ?? m}</Badge>)}
              </div>
            )}
            <div className="hr" />
            <Btn kind="primary" onClick={() => setEditOpen(true)}>✏️ تعديل الميزات (يصدر مفتاحاً جديداً)</Btn>
          </div>

          <div className="card">
            <div className="card-title">⚡ إطفاء مؤقت من السحابة (بدون مفتاح جديد)</div>
            {!servicesAvailable ? (
              <div className="notice notice-warn" style={{ display: 'block' }}>
                يحتاج هذا القسم مساحة الخدمات <span className="mono">SHOPSYS_KV</span> (الأعلام السحابية) وهي غير مضبوطة.
                <div style={{ marginBlockStart: 8 }}><Link className="btn btn-sm" to="/settings">اضبطها من الإعدادات</Link></div>
                <div className="muted" style={{ fontSize: 12.5, marginBlockStart: 8 }}>
                  بديل يعمل الآن: «تعديل الميزات» — يصدر مفتاحاً جديداً بالصلاحيات المطلوبة.
                </div>
              </div>
            ) : null}
            <div className="muted" style={{ fontSize: 12.5, marginBlockEnd: 10 }}>
              يعمل على الميزات الممنوحة فقط — كما في أمر البوت «عطل / فعل». مناسب لمتأخرات السداد مثلاً.
            </div>
            {LICENSE_FEATURES.map((f) => {
              const granted = selected.features.includes(f)
              const disabled = flags.disabledFeatures.includes(f)
              return (
                <div key={f} className="check-row" style={{ opacity: granted ? 1 : 0.55 }}>
                  <span style={{ flex: 1 }}>
                    {FEATURE_LABELS_AR[f]} {granted ? null : <span className="check-desc">(غير ممنوحة)</span>}
                    {disabled ? <span className="check-desc"> — مطفأة حالياً</span> : null}
                  </span>
                  {granted ? (
                    disabled
                      ? <Btn size="sm" kind="primary" disabled={busy || !servicesAvailable} onClick={() => void toggleFlag(f, false)}>إعادة تفعيل</Btn>
                      : <Btn size="sm" kind="danger" disabled={busy || !servicesAvailable} onClick={() => void toggleFlag(f, true)}>إطفاء</Btn>
                  ) : <Badge kind="muted">—</Badge>}
                </div>
              )
            })}
            {flags.noteAr ? <div className="muted" style={{ fontSize: 12.5, marginBlockStart: 8 }}>📝 {flags.noteAr}</div> : null}
          </div>
        </div>
      )}

      {selected ? (
        <IssueDialog open={editOpen} customer={selected} onClose={() => setEditOpen(false)} onDone={async () => { setEditOpen(false); await refresh() }} />
      ) : null}
    </>
  )
}
