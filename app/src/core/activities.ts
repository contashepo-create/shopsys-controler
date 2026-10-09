/**
 * الأنشطة — قائمة منسدلة موحّدة لاختيار نشاط العميل عند الإصدار / التنشيط / التفعيل.
 * ─────────────────────────────────────────────────────────────
 * • ACTIVITY_CATALOG: الأنشطة المعروفة (المعرّف كما يكتبه تطبيق العميل + اسم عربي).
 *   ⚠️ المعرّف يُوقَّع داخل المفتاح (activityId) ويُقصر المفتاح عليه، فيجب أن يطابق
 *   معرّف النشاط في تطبيق تَحَكَّم حرفياً. لإضافة نشاط: أضف سطراً هنا فقط.
 * • أي معرّف نشاط يظهر في بيانات العملاء (KV) ولم يُذكر هنا يُضاف تلقائياً إلى القائمة،
 *   فلا يضيع نشاط عميل حتى لو لم يُسجَّل في الكتالوج بعد.
 * • نشاط العميل «كما اختاره»: يُقرأ من سجل الجهاز dev:<deviceId> (الحقل activityId أو
 *   أحد أسمائه البديلة)، ثم من المفتاح الموقّع الحالي — انظر resolveClientActivity.
 */

export interface ActivityDef {
  id: string
  label: string
}

export const ACTIVITY_CATALOG: readonly ActivityDef[] = [
  { id: 'grocery', label: 'بقالة / سوبر ماركت' },
  { id: 'pharmacy', label: 'صيدلية' },
  { id: 'restaurant', label: 'مطعم / كافيه' },
  { id: 'clothing', label: 'ملابس وأحذية' },
  { id: 'electronics', label: 'إلكترونيات وموبايلات' },
  { id: 'jewelry', label: 'ذهب ومجوهرات' },
  { id: 'maintenance', label: 'مركز صيانة' },
  { id: 'laundry', label: 'مغسلة' },
  { id: 'clinic', label: 'عيادة' },
  { id: 'lab', label: 'معمل / مختبر' },
  { id: 'cars', label: 'سيارات وقطع غيار' },
  { id: 'realestate', label: 'عقارات' },
  { id: 'contracting', label: 'مقاولات' },
  { id: 'logistics', label: 'شحن ولوجستيات' },
  { id: 'equipment_rental', label: 'تأجير معدات' },
  { id: 'booking', label: 'حجوزات (قاعات / ملاعب)' },
  { id: 'wallet_services', label: 'خدمات مالية ومحافظ' },
  { id: 'factory', label: 'مصنع / تصنيع' },
  { id: 'wholesale', label: 'تجارة جملة' },
  { id: 'building_materials', label: 'مواد بناء' },
  { id: 'general', label: 'نشاط تجاري عام' },
]

/**
 * الأقسام المضمّنة أصلاً في كل نشاط — لا تُعرض في «إضافة قسم» حتى لا يُرسَل للعميل قسم عنده.
 * ⚠️ يجب أن تطابق تعريف الأنشطة في تطبيق تَحَكَّم (عقد «إضافة قسم خارج النشاط»).
 * لو احتجت قسماً مخفياً هنا: زر «إظهار كل الأقسام» في نموذج الإصدار.
 */
export const ACTIVITY_MODULES: Readonly<Record<string, readonly string[]>> = {
  grocery: ['pos', 'inventory', 'purchases'],
  pharmacy: ['pos', 'inventory', 'purchases'],
  restaurant: ['pos', 'inventory', 'purchases', 'recipes'],
  clothing: ['pos', 'inventory', 'purchases'],
  electronics: ['pos', 'inventory', 'purchases'],
  jewelry: ['pos', 'inventory', 'purchases', 'jewelry'],
  maintenance: ['pos', 'inventory', 'maintenance'],
  laundry: ['pos', 'laundry'],
  clinic: ['clinic', 'booking'],
  lab: ['lab', 'booking'],
  cars: ['pos', 'inventory', 'purchases', 'cars'],
  realestate: ['realestate', 'installments'],
  contracting: ['contracting', 'purchases', 'inventory'],
  logistics: ['logistics'],
  equipment_rental: ['equipment_rental', 'inventory'],
  booking: ['booking', 'pos'],
  wallet_services: ['wallet_services', 'pos'],
  factory: ['processing', 'inventory', 'purchases'],
  wholesale: ['pos', 'inventory', 'purchases'],
  building_materials: ['pos', 'inventory', 'purchases'],
  general: ['pos', 'inventory', 'purchases'],
}

/** أقسام النشاط المضمّنة (فارغة لنشاط مجهول أو «أي نشاط»). */
export function modulesIncludedInActivity(activityId: string | null | undefined): readonly string[] {
  // Object.hasOwn: معرّف مكتوب يدوياً مثل «toString» لا يجوز أن يلتقط خصائص Object
  return activityId && Object.hasOwn(ACTIVITY_MODULES, activityId) ? ACTIVITY_MODULES[activityId] : []
}

const LABEL_BY_ID: ReadonlyMap<string, string> = new Map(ACTIVITY_CATALOG.map((a) => [a.id, a.label]))

/**
 * معرّف نشاط صالح: 1–64 حرفاً بلا مسافات أو علامات تنصيص.
 * ⚠️ لا نغيّر حالة الأحرف ولا نحوّل المعرّف أبداً — يُوقَّع كما هو داخل المفتاح، وأي تغيير
 * (مثل carParts → carparts) يجعل التطبيق يرى نشاطاً مختلفاً.
 */
export const ACTIVITY_ID_RE = /^[^\s"'\\]{1,64}$/u

export function normalizeActivityId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  return ACTIVITY_ID_RE.test(v) ? v : null
}

/** الاسم العربي للنشاط — يسقط إلى المعرّف نفسه لو لم يكن في الكتالوج. */
export function activityLabel(id: string | null | undefined): string {
  if (!id) return 'أي نشاط'
  return LABEL_BY_ID.get(id) ?? id
}

/** «صيدلية (pharmacy)» — للعرض في الجداول والتلميحات. */
export function activityDisplay(id: string | null | undefined): string {
  if (!id) return '—'
  const label = LABEL_BY_ID.get(id)
  return label ? `${label} (${id})` : id
}

/** أسماء الحقول التي قد يكتب فيها تطبيق العميل / الـ worker النشاط المختار في dev:<deviceId>. */
export const CLIENT_ACTIVITY_FIELDS = ['activityId', 'activity', 'requestedActivityId', 'businessActivity', 'businessType'] as const

/** يستخرج النشاط الذي اختاره العميل من سجل الجهاز (أول حقل صالح). */
export function activityFromDevRecord(dev: Record<string, unknown> | null | undefined): string | null {
  if (!dev) return null
  for (const f of CLIENT_ACTIVITY_FIELDS) {
    const v = normalizeActivityId(dev[f])
    if (v) return v
  }
  return null
}

export type ActivitySource = 'client' | 'license' | 'none'

/**
 * نشاط العميل الافتراضي عند الإصدار/التنشيط:
 *   1) ما اختاره العميل (سجل الجهاز) — وهو أيضاً آخر نشاط اعتمده المطوّر لأن الإصدار يكتبه هناك
 *   2) نشاط المفتاح الموقّع الحالي
 *   3) لا شيء → «أي نشاط»
 */
export function resolveClientActivity(input: { clientActivityId?: string | null; activityId?: string | null }): { id: string; source: ActivitySource } {
  const client = normalizeActivityId(input.clientActivityId)
  if (client) return { id: client, source: 'client' }
  const signed = normalizeActivityId(input.activityId)
  if (signed) return { id: signed, source: 'license' }
  return { id: '', source: 'none' }
}

export interface ActivityOption {
  value: string
  label: string
}

/**
 * خيارات القائمة المنسدلة: الكتالوج + أي نشاط موجود عند العملاء + القيم الإضافية
 * (مثل نشاط العميل الحالي) — بلا تكرار، والمجهول يُعرض بمعرّفه.
 */
export function buildActivityOptions(
  customers: readonly { activityId?: string | null; clientActivityId?: string | null }[],
  extra: readonly (string | null | undefined)[] = [],
): ActivityOption[] {
  const out: ActivityOption[] = ACTIVITY_CATALOG.map((a) => ({ value: a.id, label: `${a.label} — ${a.id}` }))
  const seen = new Set(out.map((o) => o.value))
  const add = (raw: string | null | undefined, label: (id: string) => string) => {
    const id = normalizeActivityId(raw)
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push({ value: id, label: label(id) })
  }
  for (const c of customers) {
    add(c.clientActivityId, (id) => `${id} (من بيانات العملاء)`)
    add(c.activityId, (id) => `${id} (من بيانات العملاء)`)
  }
  for (const e of extra) add(e, (id) => id)
  return out
}
