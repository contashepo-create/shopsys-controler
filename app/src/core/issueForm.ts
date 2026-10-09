/**
 * منطق نموذج الإصدار الموحّد (نقي — بلا واجهة):
 *  • الفروع: الحقل «فروع إضافية» هو مصدر الحقيقة؛ ميزة «تعدد الفروع» تُضبط تلقائياً منه
 *    (لا خانة اختيار منفصلة) — 1 = فرع إضافي واحد بجانب الفرع الرئيسي.
 *  • الأقسام: تُقسَّم إلى «مضمّنة في النشاط» و«عنده الآن» و«يمكن إضافتها» حتى لا يُرسَل
 *    للعميل قسم موجود عنده، وتُزال التكرارات قبل التوقيع.
 *  • المفتاح الجديد يحلّ محلّ القديم بالكامل (ليس إضافة فوقه) — لذلك الأقسام والميزات
 *    الموجودة تبقى محددة افتراضياً وإلا سُحبت من العميل.
 */

import { EXTRA_MODULES, PLAN_LIMITS, type LicenseFeature, type LicensePlan } from './license.ts'
import { modulesIncludedInActivity } from './activities.ts'

/** الميزات التي تُشتق تلقائياً ولا تُعرض كخانة اختيار. */
export const DERIVED_FEATURES: readonly LicenseFeature[] = ['multi_branch']

export function toCount(raw: string | number | null | undefined): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim() || 0)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** الحد الكلي للفروع = فروع الباقة + الإضافية. */
export function totalBranches(plan: LicensePlan, extraBranches: number): number {
  return PLAN_LIMITS[plan].maxBranches + Math.max(0, extraBranches)
}

export function totalUsers(plan: LicensePlan, extraUsers: number): number {
  return PLAN_LIMITS[plan].maxUsers + Math.max(0, extraUsers)
}

/** الميزات النهائية للتوقيع: المختارة يدوياً + «تعدد الفروع» عندما يتجاوز الحد فرعاً واحداً. */
export function finalFeatures(selected: readonly LicenseFeature[], plan: LicensePlan, extraBranches: number): LicenseFeature[] {
  const out = new Set(selected.filter((f) => !DERIVED_FEATURES.includes(f)))
  if (totalBranches(plan, extraBranches) > 1) out.add('multi_branch')
  return [...out]
}

/** الأقسام النهائية للتوقيع: بلا تكرار وبالترتيب القياسي. */
export function finalModules(selected: readonly string[]): string[] {
  const set = new Set(selected)
  const known = EXTRA_MODULES.filter((m) => set.has(m))
  const unknown = [...set].filter((m) => !EXTRA_MODULES.includes(m))
  return [...known, ...unknown]
}

export interface ModuleSplit {
  /** مضمّنة أصلاً في نشاط العميل — لا داعي لإضافتها */
  included: string[]
  /** ممنوحة له في مفتاحه الحالي (تبقى في المفتاح الجديد ما لم تُزل) */
  owned: string[]
  /** يمكن إضافتها (غير موجودة عنده بأي شكل) */
  addable: string[]
}

export function splitModules(input: { activityId?: string | null; owned: readonly string[]; showAll?: boolean }): ModuleSplit {
  const included = input.showAll ? [] : modulesIncludedInActivity(input.activityId).filter((m) => EXTRA_MODULES.includes(m))
  const owned = finalModules(input.owned)
  const taken = new Set([...included, ...owned])
  return { included: [...included], owned, addable: EXTRA_MODULES.filter((m) => !taken.has(m)) }
}

export interface GlobalDefaults {
  plan: LicensePlan
  days: number
  features: LicenseFeature[]
  extraUsers: number
  extraBranches: number
  extraModules: string[]
}

export const FALLBACK_DEFAULTS: GlobalDefaults = { plan: 'basic', days: 365, features: [], extraUsers: 0, extraBranches: 0, extraModules: [] }

/** settings:global (نفس شكل البوت) → افتراضيات صالحة دائماً. */
export function parseGlobalDefaults(raw: string | null): GlobalDefaults {
  if (!raw) return { ...FALLBACK_DEFAULTS }
  try {
    const o = JSON.parse(raw) as Partial<GlobalDefaults>
    const plan = (['trial', 'basic', 'pro', 'lifetime'] as const).includes(o.plan as LicensePlan) ? o.plan as LicensePlan : 'basic'
    return {
      plan,
      days: toCount(o.days) || 365,
      features: Array.isArray(o.features) ? o.features.filter((f): f is LicenseFeature => typeof f === 'string') : [],
      extraUsers: toCount(o.extraUsers),
      extraBranches: toCount(o.extraBranches),
      extraModules: Array.isArray(o.extraModules) ? o.extraModules.filter((m): m is string => typeof m === 'string') : [],
    }
  } catch {
    return { ...FALLBACK_DEFAULTS }
  }
}

/**
 * المدة الافتراضية عند تعديل اشتراك قائم: الأيام المتبقية بالضبط — فيبقى تاريخ الانتهاء كما هو
 * عند إضافة قسم أو ميزة. للمنتهي أو الجديد: مدة الافتراضيات.
 */
export function defaultRenewDays(expiresAt: string | null, todayIso: string, fallback = 365): number {
  if (!expiresAt) return fallback
  // يقبل «YYYY-MM-DD» أو ISO كاملاً بوقت (بعض السجلات القديمة)
  const left = Math.round((Date.parse(expiresAt.slice(0, 10) + 'T00:00:00Z') - Date.parse(todayIso.slice(0, 10) + 'T00:00:00Z')) / 86400000)
  return Number.isFinite(left) && left > 0 ? left : fallback
}
