import { useMemo } from 'react'
import { activityDisplay, buildActivityOptions, normalizeActivityId, type ActivitySource } from '../../core/activities.ts'
import { useDataStore } from '../../stores/data.store.ts'

const ANY = ''
const CUSTOM = '__custom__'

/**
 * قائمة منسدلة لاختيار النشاط — تُستخدم في كل نوافذ الإصدار / التنشيط / التفعيل.
 * • تُعبّأ تلقائياً بنشاط العميل كما اختاره (clientActivityId) ويمكن تغييره لأي نشاط آخر.
 * • خيار «نشاط آخر» يفتح حقلاً لكتابة معرّف غير موجود في القائمة.
 * • عند الابتعاد عن اختيار العميل يظهر تنبيه وزر للرجوع إليه بنقرة.
 */
export function ActivityPicker(props: {
  value: string
  onChange: (v: string) => void
  /** النشاط الذي اختاره العميل (يُعلَّم في القائمة ⭐) */
  clientActivityId?: string | null
  /** مصدر القيمة الافتراضية — للتلميح فقط */
  source?: ActivitySource
  /** هل الحقل في وضع الكتابة اليدوية؟ (يُدار من الأب ليبقى بعد إعادة الرسم) */
  custom: boolean
  onCustomChange: (v: boolean) => void
  label?: string
}) {
  const customers = useDataStore((s) => s.customers)
  const client = normalizeActivityId(props.clientActivityId)
  const options = useMemo(
    () => buildActivityOptions(customers, [client, props.custom ? null : props.value]),
    [customers, client, props.value, props.custom],
  )

  const selectValue = props.custom ? CUSTOM : props.value
  const changedFromClient = client != null && props.value !== client

  function onSelect(v: string) {
    if (v === CUSTOM) {
      props.onCustomChange(true)
      return
    }
    props.onCustomChange(false)
    props.onChange(v)
  }

  const customValid = !props.custom || props.value === '' || normalizeActivityId(props.value) === props.value

  return (
    <div className="field">
      <label>{props.label ?? 'النشاط'}</label>
      <select className="select" value={selectValue} onChange={(e) => onSelect(e.target.value)}>
        <option value={ANY}>— أي نشاط (بدون قصر المفتاح على نشاط) —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value === client ? `⭐ ${o.label} — اختيار العميل` : o.label}
          </option>
        ))}
        <option value={CUSTOM}>✏️ نشاط آخر (كتابة المعرّف يدوياً)…</option>
      </select>

      {props.custom ? (
        <input
          className="input input-mono"
          dir="ltr"
          autoFocus
          placeholder="مثال: bookstore"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value.trim().toLowerCase())}
        />
      ) : null}

      {!customValid ? (
        <span className="hint" style={{ color: 'var(--danger)' }}>المعرّف بحروف لاتينية صغيرة وأرقام و _ فقط — كما في تطبيق العميل</span>
      ) : client ? (
        changedFromClient ? (
          <span className="hint" style={{ color: 'var(--warn)' }}>
            ⚠️ مختلف عن اختيار العميل: <b>{activityDisplay(client)}</b>{' '}
            <button type="button" className="btn btn-sm btn-ghost" style={{ paddingBlock: 0 }}
              onClick={() => { props.onCustomChange(false); props.onChange(client) }}>
              ↩️ الرجوع لاختيار العميل
            </button>
          </span>
        ) : (
          <span className="hint" style={{ color: 'var(--ok)' }}>✓ كُتب تلقائياً كما اختاره العميل — يمكنك تغييره بطلب العميل</span>
        )
      ) : props.source === 'license' && props.value ? (
        <span className="hint">✓ عُبّئ تلقائياً من مفتاح العميل الحالي — يمكنك تغييره بطلب العميل</span>
      ) : (
        <span className="hint">اختياري — لم يُسجِّل العميل نشاطاً بعد؛ اختر من القائمة أو اتركه «أي نشاط»</span>
      )}
    </div>
  )
}

/** هل قيمة النشاط صالحة للإرسال؟ (فارغة = أي نشاط) */
export function isActivityValueValid(v: string): boolean {
  return v === '' || normalizeActivityId(v) === v
}
