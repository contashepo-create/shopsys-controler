import { useEffect, useMemo, useState } from 'react'
import { issueLicense, lookupDevice, readGlobalDefaults, sendKeyToCustomer, type IssueLicenseResult } from '../../data/actions.ts'
import { useDataStore } from '../../stores/data.store.ts'
import {
  DEVICE_ID_RE, generateDeviceId, expiresAfterDays,
  LICENSE_FEATURES, FEATURE_LABELS_AR, MODULE_LABELS_AR, PLAN_LABELS_AR, PLAN_LIMITS,
  type LicensePlan, type LicenseFeature,
} from '../../core/license.ts'
import { type CustomerView } from '../../core/customers.ts'
import { activityDisplay, activityLabel, resolveClientActivity, type ActivitySource } from '../../core/activities.ts'
import {
  DERIVED_FEATURES, FALLBACK_DEFAULTS, defaultRenewDays, finalFeatures, splitModules, toCount, totalBranches, totalUsers,
  type GlobalDefaults,
} from '../../core/issueForm.ts'
import { Btn, Field, Select, useToast } from './ui.tsx'
import { ActivityPicker, isActivityValueValid } from './ActivityPicker.tsx'
import { LicenseKeyResult } from './LicenseKeyResult.tsx'

const PLAN_OPTIONS = (Object.keys(PLAN_LABELS_AR) as LicensePlan[]).map((p) => ({ value: p, label: PLAN_LABELS_AR[p] }))
const SELECTABLE_FEATURES = LICENSE_FEATURES.filter((f) => !DERIVED_FEATURES.includes(f))

/**
 * نموذج الإصدار الموحّد — نفس النموذج في «التراخيص» وبطاقة العميل (تنشيط / تجديد / إضافة قسم أو ميزة).
 *  • معرّف الجهاز → يُقرأ العميل مباشرة من السحابة فيُكتب اسمه ونشاطه وباقته وأقسامه تلقائياً
 *  • جهاز جديد → يُعبّأ من الافتراضيات (settings:global) — لا تُطلب الميزات مرتين
 *  • الفروع: حقل واحد للفروع الإضافية، و«تعدد الفروع» يُضبط تلقائياً منه
 *  • الأقسام: تُخفى أقسام النشاط وما عنده فعلاً، فلا يُرسَل له قسم موجود
 */
export function IssueForm(props: {
  /** عميل معروف (من بطاقته) — يثبّت معرّف الجهاز */
  customer?: CustomerView | null
  onIssued?: (res: IssueLicenseResult) => void | Promise<void>
  onClose?: () => void
}) {
  const toast = useToast()
  const customers = useDataStore((s) => s.customers)
  const fixed = props.customer ?? null

  const [deviceId, setDeviceId] = useState(fixed?.deviceId ?? '')
  const [found, setFound] = useState<CustomerView | null>(fixed)
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'found' | 'new'>(fixed ? 'found' : 'idle')
  const [defaults, setDefaults] = useState<GlobalDefaults | null>(null)
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null)

  const [customerName, setCustomerName] = useState('')
  const [nameAuto, setNameAuto] = useState(true)
  const [plan, setPlan] = useState<LicensePlan>('basic')
  const [days, setDays] = useState('365')
  const [activityId, setActivityId] = useState('')
  const [activitySource, setActivitySource] = useState<ActivitySource>('none')
  const [activityCustom, setActivityCustom] = useState(false)
  const [extraUsers, setExtraUsers] = useState('')
  const [extraBranches, setExtraBranches] = useState('')
  const [features, setFeatures] = useState<LicenseFeature[]>([])
  const [modules, setModules] = useState<string[]>([])
  const [showAllModules, setShowAllModules] = useState(false)
  const [burnPrevious, setBurnPrevious] = useState(false)

  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<IssueLicenseResult | null>(null)
  const [sent, setSent] = useState(false)

  const normalizedId = deviceId.trim().toUpperCase()
  const deviceValid = DEVICE_ID_RE.test(normalizedId)
  const existing = found && found.deviceId === normalizedId ? found : null

  useEffect(() => { void readGlobalDefaults().then(setDefaults).catch(() => setDefaults({ ...FALLBACK_DEFAULTS })) }, [])

  // التعرّف على الجهاز: من القائمة المحمّلة فوراً، ثم من السحابة مباشرة (أحدث بيانات)
  useEffect(() => {
    if (fixed) return
    if (!deviceValid) { setFound(null); setLookupState('idle'); return }
    const local = customers.find((c) => c.deviceId === normalizedId) ?? null
    if (local) { setFound(local); setLookupState('found') } else setLookupState('loading')
    let cancelled = false
    void lookupDevice(normalizedId).then((v) => {
      if (cancelled) return
      if (v) { setFound(v); setLookupState('found') } else if (!local) { setFound(null); setLookupState('new') }
    }).catch(() => { if (!cancelled && !local) setLookupState('new') })
    return () => { cancelled = true }
  }, [normalizedId, deviceValid, customers, fixed])

  // تعبئة تلقائية — مرة لكل هوية (عميل موجود / جهاز جديد)، ولا نكتب فوق تعديلاتك بعدها
  useEffect(() => {
    // ننتظر الافتراضيات أولاً حتى لا تُبنى التعبئة على قيم مؤقتة (تسقط لقيم آمنة عند الفشل)
    if (!defaults) return
    const today = new Date().toISOString().slice(0, 10)
    if (existing) {
      const tag = `c:${existing.deviceId}:${existing.fingerprint ?? ''}`
      if (prefilledFor === tag) return
      setPrefilledFor(tag)
      if (existing.customer) { setCustomerName(existing.customer); setNameAuto(true) }
      const act = resolveClientActivity(existing)
      setActivityId(act.id); setActivitySource(act.source); setActivityCustom(false)
      const validPlan = (['trial', 'basic', 'pro', 'lifetime'] as const).includes(existing.plan as LicensePlan)
      setPlan(validPlan ? existing.plan as LicensePlan : defaults.plan)
      // اشتراك ما زال له وقت (حتى لو معطّل) → نفس تاريخ انتهائه؛ منتهٍ أو بلا اشتراك → مدة الافتراضيات
      setDays(String(validPlan ? defaultRenewDays(existing.expiresAt, today, defaults.days) : defaults.days))
      setExtraUsers(existing.extraUsers ? String(existing.extraUsers) : '')
      setExtraBranches(existing.extraBranches ? String(existing.extraBranches) : '')
      setFeatures(existing.features.filter((f) => !DERIVED_FEATURES.includes(f)))
      setModules([...existing.extraModules])
      return
    }
    if (lookupState === 'new' || (lookupState === 'idle' && !fixed)) {
      const tag = 'new'
      if (prefilledFor === tag) return
      const fromCustomer = prefilledFor?.startsWith('c:')
      setPrefilledFor(tag)
      if (fromCustomer && nameAuto) setCustomerName('')
      setActivityId(''); setActivitySource('none'); setActivityCustom(false)
      setPlan(defaults.plan)
      setDays(String(defaults.days))
      setExtraUsers(defaults.extraUsers ? String(defaults.extraUsers) : '')
      setExtraBranches(defaults.extraBranches ? String(defaults.extraBranches) : '')
      setFeatures(defaults.features.filter((f) => !DERIVED_FEATURES.includes(f)))
      setModules([...defaults.extraModules])
    }
  }, [existing, lookupState, defaults, prefilledFor, fixed, nameAuto])

  const ownedModules = useMemo(() => existing?.extraModules ?? [], [existing])
  const split = useMemo(() => splitModules({ activityId, owned: ownedModules, showAll: showAllModules }), [activityId, ownedModules, showAllModules])
  const branchesExtra = toCount(extraBranches)
  const usersExtra = toCount(extraUsers)
  const branchesTotal = totalBranches(plan, branchesExtra)
  const signedFeatures = finalFeatures(features, plan, branchesExtra)
  const signedModules = modules.filter((m) => ownedModules.includes(m) || !split.included.includes(m))
  const removedModules = ownedModules.filter((m) => !modules.includes(m))
  const addedModules = signedModules.filter((m) => !ownedModules.includes(m))
  const expiry = plan === 'lifetime' ? null : expiresAfterDays(toCount(days) || 365)
  const todayIso = new Date().toISOString().slice(0, 10)
  const keepDays = existing?.expiresAt ? defaultRenewDays(existing.expiresAt, todayIso, 0) : 0
  /** «تعدد الفروع» كان عنده وسيُزال لأن الحد الكلي صار فرعاً واحداً */
  const losesMultiBranch = existing?.features.includes('multi_branch') === true && !signedFeatures.includes('multi_branch')

  const toggle = <T,>(list: T[], set: (v: T[]) => void, v: T) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  function newDeviceId() {
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    setDeviceId(generateDeviceId(bytes))
  }

  function summary(): string {
    const parts = [`${PLAN_LABELS_AR[plan]} حتى ${expiry ?? 'مدى الحياة'}`]
    if (activityId) parts.push(`النشاط: ${activityLabel(activityId)}`)
    if (addedModules.length) parts.push(`أقسام جديدة: ${addedModules.map((m) => MODULE_LABELS_AR[m] ?? m).join('، ')}`)
    if (branchesExtra) parts.push(`فروع إضافية: ${branchesExtra}`)
    if (usersExtra) parts.push(`مستخدمون إضافيون: ${usersExtra}`)
    return parts.join(' · ')
  }

  async function submit() {
    if (!deviceValid) { toast('معرّف الجهاز غير صحيح — الصيغة SHOP-XXXX-XXXX-XXXX', 'error'); return }
    if (!customerName.trim()) { toast('اسم العميل مطلوب', 'error'); return }
    if (!isActivityValueValid(activityId)) { toast('معرّف النشاط غير صالح', 'error'); return }
    setBusy(true)
    try {
      const res = await issueLicense({
        deviceId: normalizedId,
        customer: customerName.trim(),
        plan,
        days: toCount(days) || 365,
        activityId: activityId || undefined,
        extraUsers: usersExtra,
        extraBranches: branchesExtra,
        features: signedFeatures,
        extraModules: signedModules,
      }, { renew: existing != null, burnFingerprint: burnPrevious ? existing?.fingerprint : null })
      setIssued(res)
      if (res.notes?.length) toast(res.notes[0], 'info')
      else toast('تم إصدار المفتاح ✓', 'ok')
      await props.onIssued?.(res)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    setBusy(false)
  }

  async function sendToCustomer() {
    if (!issued) return
    setBusy(true)
    try {
      await sendKeyToCustomer({ deviceId: normalizedId, customer: customerName.trim(), key: issued.key, fingerprint: issued.fingerprint, summary: summary() })
      setSent(true)
      toast('📨 وصل المفتاح إلى إشعارات تطبيق العميل', 'ok')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
    setBusy(false)
  }

  if (issued) {
    return (
      <div>
        <div className="notice notice-ok" style={{ display: 'block', marginBlockEnd: 12 }}>
          ✅ صدر المفتاح لـ <b>{customerName}</b> — {summary()}
        </div>
        <LicenseKeyResult licenseKey={issued.key} fingerprint={issued.fingerprint} onCopy={() => toast('تم نسخ المفتاح ✓', 'ok')} />
        <div className="row" style={{ marginBlockStart: 12, justifyContent: 'space-between' }}>
          <Btn kind="primary" disabled={busy || sent} onClick={() => void sendToCustomer()}>
            {sent ? '📨 أُرسل للعميل ✓' : '📨 أرسل المفتاح للعميل داخل التطبيق'}
          </Btn>
          {props.onClose ? <Btn onClick={props.onClose}>تم</Btn> : (
            <Btn onClick={() => { setIssued(null); setSent(false); setDeviceId(''); setCustomerName(''); setPrefilledFor(null); setFound(null) }}>إصدار مفتاح آخر</Btn>
          )}
        </div>
        <ActivationExplainer />
      </div>
    )
  }

  return (
    <div>
      {/* 1) الجهاز والعميل */}
      <div className="grid-2">
        <div className="field">
          <label>معرّف الجهاز *</label>
          {fixed ? (
            <input className="input input-mono" value={fixed.deviceId} disabled dir="ltr" />
          ) : (
            <div className="row">
              <input className="input input-mono" style={{ flex: 1 }} value={deviceId} dir="ltr" placeholder="SHOP-XXXX-XXXX-XXXX"
                onChange={(e) => setDeviceId(e.target.value.toUpperCase())} />
              <Btn size="sm" onClick={newDeviceId} title="توليد معرّف لجهاز تجريبي">🎲</Btn>
            </div>
          )}
          <span className="hint">
            {!deviceValid ? 'يظهر للعميل في شاشة التفعيل داخل التطبيق'
              : lookupState === 'loading' ? '… جارٍ البحث عن الجهاز'
              : existing ? `✓ عميل مسجَّل — ${existing.customer || 'بلا اسم'} · ${PLAN_LABELS_AR[existing.plan as LicensePlan] ?? existing.plan ?? 'بلا باقة'}${existing.expiresAt ? ` حتى ${existing.expiresAt}` : ''}`
              : '✓ جهاز جديد — عُبّئ النموذج من الافتراضيات'}
          </span>
        </div>
        <Field label="اسم العميل *" value={customerName} onChange={(v) => { setCustomerName(v); setNameAuto(false) }}
          placeholder="بقالة النور — المنصورة"
          hint={existing?.customer && customerName === existing.customer ? '✓ كُتب تلقائياً من بيانات الجهاز' : undefined} />
      </div>

      <ActivityPicker value={activityId} onChange={setActivityId} clientActivityId={existing?.clientActivityId}
        source={activitySource} custom={activityCustom} onCustomChange={setActivityCustom} />

      {/* 2) الباقة والمدة والحدود */}
      <div className="grid-2">
        <Select label="الباقة" value={plan} onChange={(v) => setPlan(v as LicensePlan)} options={PLAN_OPTIONS} />
        {plan === 'lifetime' ? (
          <Field label="المدة" value="مدى الحياة" onChange={() => {}} hint="لا تاريخ انتهاء" />
        ) : (
          <div className="field">
            <label>المدة (أيام)</label>
            <input className="input" dir="ltr" value={days} onChange={(e) => setDays(e.target.value)} />
            <div className="row" style={{ gap: 6 }}>
              {keepDays > 0 ? <Btn size="sm" kind={toCount(days) === keepDays ? 'primary' : 'default'} onClick={() => setDays(String(keepDays))}>إبقاء تاريخه ({existing?.expiresAt})</Btn> : null}
              {[30, 90, 365].map((d) => (
                <Btn key={d} size="sm" kind={toCount(days) === d && d !== keepDays ? 'primary' : 'default'} onClick={() => setDays(String(d))}>
                  {d === 30 ? 'شهر' : d === 90 ? '3 أشهر' : 'سنة'}
                </Btn>
              ))}
            </div>
            <span className="hint">ينتهي في {expiry}{existing?.expiresAt && expiry === existing.expiresAt ? ' — نفس تاريخه الحالي' : ''}</span>
          </div>
        )}
        <Field label="فروع إضافية بجانب الفرع الرئيسي" value={extraBranches} onChange={setExtraBranches} dir="ltr" placeholder="0"
          hint={`الحد الكلي: ${branchesTotal} ${branchesTotal === 1 ? 'فرع (الرئيسي فقط)' : 'فروع'} — الباقة تعطي ${PLAN_LIMITS[plan].maxBranches}${branchesTotal > 1 ? ' · تعدد الفروع يُفعَّل تلقائياً' : ''}`} />
        <Field label="مستخدمون إضافيون" value={extraUsers} onChange={setExtraUsers} dir="ltr" placeholder="0"
          hint={`الحد الكلي: ${totalUsers(plan, usersExtra)} مستخدم — الباقة تعطي ${PLAN_LIMITS[plan].maxUsers}`} />
      </div>

      {/* 3) الميزات */}
      <div className="section-title">الميزات</div>
      <div className="chip-grid">
        {SELECTABLE_FEATURES.map((f) => (
          <label key={f} className={`chip-check${features.includes(f) ? ' on' : ''}`}>
            <input type="checkbox" checked={features.includes(f)} onChange={() => toggle(features, setFeatures, f)} />
            <span>{FEATURE_LABELS_AR[f]}</span>
            {existing?.features.includes(f) ? <span className="chip-tag">عنده</span> : null}
          </label>
        ))}
      </div>

      {/* 4) الأقسام */}
      <div className="section-title row" style={{ justifyContent: 'space-between' }}>
        <span>الأقسام الإضافية</span>
        <label className="muted" style={{ fontSize: 12, fontWeight: 400, cursor: 'pointer' }}>
          <input type="checkbox" checked={showAllModules} onChange={() => setShowAllModules(!showAllModules)} /> إظهار كل الأقسام
        </label>
      </div>
      {split.included.length ? (
        <div className="muted" style={{ fontSize: 12.5, marginBlockEnd: 8 }}>
          مضمّنة في نشاط «{activityLabel(activityId)}» ولا تحتاج إضافة: {split.included.map((m) => MODULE_LABELS_AR[m] ?? m).join('، ')}
        </div>
      ) : null}
      {split.owned.length ? (
        <>
          <div className="muted" style={{ fontSize: 12.5, marginBlockEnd: 6 }}>عنده الآن (تبقى في المفتاح الجديد — أزل العلامة لسحب القسم):</div>
          <div className="chip-grid" style={{ marginBlockEnd: 10 }}>
            {split.owned.map((m) => (
              <label key={m} className={`chip-check${modules.includes(m) ? ' on' : ' off'}`}>
                <input type="checkbox" checked={modules.includes(m)} onChange={() => toggle(modules, setModules, m)} />
                <span>{MODULE_LABELS_AR[m] ?? m}</span>
                {!modules.includes(m) ? <span className="chip-tag danger">سيُسحب</span> : null}
              </label>
            ))}
          </div>
        </>
      ) : null}
      {split.addable.length ? (
        <>
          <div className="muted" style={{ fontSize: 12.5, marginBlockEnd: 6 }}>يمكن إضافتها:</div>
          <div className="chip-grid">
            {split.addable.map((m) => (
              <label key={m} className={`chip-check${modules.includes(m) ? ' on' : ''}`}>
                <input type="checkbox" checked={modules.includes(m)} onChange={() => toggle(modules, setModules, m)} />
                <span>{MODULE_LABELS_AR[m] ?? m}</span>
              </label>
            ))}
          </div>
        </>
      ) : <div className="muted" style={{ fontSize: 12.5 }}>كل الأقسام موجودة عنده بالفعل.</div>}

      {/* 5) ملخص + إصدار */}
      <div className="hr" />
      <div className="muted" style={{ fontSize: 12.5, marginBlockEnd: 8 }}>
        <b>الملخص:</b> {PLAN_LABELS_AR[plan]} حتى {expiry ?? 'مدى الحياة'} · {activityId ? activityDisplay(activityId) : 'أي نشاط'} · {branchesTotal} فرع · {totalUsers(plan, usersExtra)} مستخدم
        {addedModules.length ? <> · <span style={{ color: 'var(--ok)' }}>+ {addedModules.map((m) => MODULE_LABELS_AR[m] ?? m).join('، ')}</span></> : null}
        {removedModules.length ? <> · <span style={{ color: 'var(--danger)' }}>− {removedModules.map((m) => MODULE_LABELS_AR[m] ?? m).join('، ')}</span></> : null}
      </div>
      {losesMultiBranch ? (
        <div className="notice notice-warn" style={{ display: 'block', marginBlockEnd: 8 }}>
          ⚠️ عنده «تعدد الفروع» حالياً وسيُزال لأن الحد الكلي فرع واحد — اكتب عدد الفروع الإضافية لو أردت إبقاءه.
        </div>
      ) : null}
      {existing?.fingerprint && existing.status !== 'revoked' ? (
        <label className="check-row">
          <input type="checkbox" checked={burnPrevious} onChange={() => setBurnPrevious(!burnPrevious)} />
          <span>حرق المفتاح السابق ({existing.fingerprint})<span className="check-desc"> — لا يعود يعمل؛ فعّلها فقط لو المفتاح الجديد سيصل للعميل فوراً، وإلا توقف برنامجه حتى يدخل الجديد</span></span>
        </label>
      ) : null}
      <div className="row" style={{ justifyContent: 'flex-end', marginBlockStart: 8 }}>
        {props.onClose ? <Btn onClick={props.onClose}>إلغاء</Btn> : null}
        <Btn kind="primary" disabled={busy || !deviceValid || !customerName.trim() || lookupState === 'loading'} onClick={() => void submit()}>
          {busy ? 'جارٍ التوقيع…' : existing ? (existing.status === 'active' || existing.status === 'expiring' ? 'إصدار المفتاح المعدَّل' : 'تنشيط العميل') : 'إصدار المفتاح'}
        </Btn>
      </div>
    </div>
  )
}

/** إجابات ثابتة: كيف يصل المفتاح؟ هل يُحرق؟ هل يعمل على جهاز آخر؟ */
export function ActivationExplainer() {
  return (
    <details className="explainer">
      <summary>ℹ️ كيف يعمل المفتاح؟</summary>
      <ul className="plain">
        <li>🔒 <b>مربوط بهذا الجهاز فقط</b>: معرّف الجهاز داخل المفتاح الموقّع، والتطبيق يرفض أي مفتاح صادر لجهاز آخر.</li>
        <li>♻️ <b>ليس للاستخدام مرة واحدة</b>: يبقى صالحاً على نفس الجهاز حتى تاريخ انتهائه أو حتى تحرقه، ويمكن إدخاله مجدداً بعد إعادة التثبيت.</li>
        <li>🔁 <b>المفتاح الجديد يحلّ محل القديم بالكامل</b>: يحمل كل الأقسام والميزات، لذلك لا يتكرر أي قسم.</li>
        <li>📨 <b>التوصيل</b>: الباقة وتاريخ الانتهاء تُحدَّث في بطاقة الاشتراك السحابية فوراً، أما الأقسام والميزات والنشاط فداخل المفتاح — أرسله للعميل (زر الإرسال يضعه في إشعارات تطبيقه) ليُدخله.</li>
        <li>🔥 <b>المفتاح القديم لا يُحرق تلقائياً</b>: استخدم خيار «حرق المفتاح السابق» أو «تعطيل» من بطاقة العميل.</li>
      </ul>
    </details>
  )
}
