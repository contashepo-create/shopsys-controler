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

/**
 * مزامنة مع تطبيق shopsys — ACTIVITY_TEMPLATES في app/src/core/activities.ts (المرجع b47043c).
 * ⚠️ معرّف النشاط يُوقَّع داخل المفتاح، والتطبيق يرفض المفتاح لنشاط مختلف. الأقسام هنا
 * هي «الافتراضية» التي يمنحها التطبيق للنشاط دون مفتاح، ولا تُرسَل في المفتاح.
 * أي قسم خارجها يُمنح بمفتاح (extraModules) — وهو ما تُصدره اللوحة.
 */
export const ACTIVITY_CATALOG: readonly ActivityDef[] = [
  { id: 'grocery', label: 'أغذية / سوبر ماركت' },
  { id: 'feed_trade', label: 'تجارة الأعلاف والحبوب' },
  { id: 'mobile', label: 'موبايلات وصيانة' },
  { id: 'clothing', label: 'ملابس وأحذية' },
  { id: 'pharmacy', label: 'صيدلية' },
  { id: 'electronics', label: 'أجهزة كهربائية' },
  { id: 'spare_parts', label: 'قطع غيار' },
  { id: 'equipment_rental', label: 'إيجار معدات ثقيلة' },
  { id: 'logistics', label: 'خدمات لوجستية ونقل' },
  { id: 'lab', label: 'معمل تحاليل طبية' },
  { id: 'contracting', label: 'مقاولات وإنشاءات' },
  { id: 'clinic', label: 'عيادة طبية' },
  { id: 'cars', label: 'معرض سيارات (بيع وإيجار)' },
  { id: 'restaurant', label: 'مطعم / كافيه' },
  { id: 'jewelry', label: 'ذهب ومجوهرات' },
  { id: 'laundry', label: 'مغسلة ملابس' },
  { id: 'butcher', label: 'جزارة ولحوم' },
  { id: 'dates', label: 'تمور وتعبئة' },
  { id: 'salon', label: 'صالون حلاقة وتجميل' },
  { id: 'bakery', label: 'مخبز وحلويات' },
  { id: 'realestate', label: 'عقارات وإدارة أملاك' },
  { id: 'trading', label: 'تجارة وتوزيع (جملة وقطاعي)' },
  { id: 'manufacturing', label: 'مصنع / ورشة إنتاج' },
  { id: 'services', label: 'شركة خدمات' },
  { id: 'stationery', label: 'مكتبة وخدمة طالب' },
  { id: 'herbalist', label: 'عطارة وبهارات' },
  { id: 'building_materials', label: 'مواد بناء وحدايد وبويات' },
  { id: 'household', label: 'منظفات وأدوات منزلية' },
  { id: 'general', label: 'نشاط عام / آخر' },
]


/**
 * الأقسام الافتراضية لكل نشاط كما يعرفها التطبيق (مطابقة لـ ACTIVITY_TEMPLATES).
 * لا تُعرض في «إضافة قسم» لأن العميل يحصل عليها من نشاطه أصلاً.
 * «إظهار كل الأقسام» في نموذج الإصدار يتجاوز هذا الجدول عند الحاجة.
 */
export const ACTIVITY_MODULES: Readonly<Record<string, readonly string[]>> = {
  grocery: ['pos', 'inventory', 'purchases', 'recipes'],
  feed_trade: ['pos', 'inventory', 'purchases', 'recipes'],
  mobile: ['pos', 'inventory', 'purchases', 'maintenance', 'installments', 'wallet_services'],
  clothing: ['pos', 'inventory', 'purchases', 'installments'],
  pharmacy: ['pos', 'inventory', 'purchases'],
  electronics: ['pos', 'inventory', 'purchases', 'maintenance', 'installments'],
  spare_parts: ['pos', 'inventory', 'purchases'],
  equipment_rental: ['equipment_rental', 'installments'],
  logistics: ['logistics'],
  lab: ['lab', 'booking'],
  contracting: ['contracting', 'inventory', 'purchases'],
  clinic: ['clinic'],
  cars: ['cars', 'equipment_rental', 'installments'],
  restaurant: ['pos', 'inventory', 'purchases', 'recipes'],
  jewelry: ['pos', 'inventory', 'purchases', 'jewelry'],
  laundry: ['laundry', 'booking'],
  butcher: ['pos', 'inventory', 'purchases', 'processing'],
  dates: ['pos', 'inventory', 'purchases', 'processing'],
  salon: ['pos', 'inventory', 'purchases', 'booking'],
  bakery: ['pos', 'inventory', 'purchases', 'recipes'],
  realestate: ['realestate'],
  trading: ['pos', 'inventory', 'purchases', 'installments'],
  manufacturing: ['inventory', 'purchases', 'recipes', 'pos'],
  services: ['pos', 'inventory', 'purchases'],
  stationery: ['pos', 'inventory', 'purchases'],
  herbalist: ['pos', 'inventory', 'purchases', 'recipes'],
  building_materials: ['pos', 'inventory', 'purchases', 'installments'],
  household: ['pos', 'inventory', 'purchases'],
  general: ['pos', 'inventory', 'purchases', 'installments'],
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
