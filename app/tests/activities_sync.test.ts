/**
 * مزامنة الأنشطة مع تطبيق shopsys (ACTIVITY_TEMPLATES، المرجع b47043c).
 * أي تعديل في التطبيق يتطلب تحديث activities.ts هنا — هذا الاختبار يمنع الانحراف الصامت.
 */
import { describe, it, expect } from 'vitest'
import { ACTIVITY_CATALOG, ACTIVITY_MODULES, modulesIncludedInActivity, activityLabel } from '../src/core/activities.ts'
import { EXTRA_MODULES } from '../src/core/license.ts'
import { splitModules } from '../src/core/issueForm.ts'

describe('مزامنة الأنشطة مع التطبيق', () => {
  it('29 نشاطاً بمعرّفات التطبيق نفسها (لا أنشطة وهمية)', () => {
    expect(ACTIVITY_CATALOG).toHaveLength(29)
    const ids = ACTIVITY_CATALOG.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const phantom of ['maintenance', 'booking', 'wallet_services', 'factory', 'wholesale']) {
      expect(ids).not.toContain(phantom)
    }
    expect(ids).toContain('manufacturing')
    expect(ids).toContain('mobile')
  })

  it('كل نشاط له قائمة أقسام افتراضية، وكل قسم فيها من أقسام المفتاح المعروفة', () => {
    for (const a of ACTIVITY_CATALOG) {
      expect(Object.hasOwn(ACTIVITY_MODULES, a.id), a.id).toBe(true)
      for (const m of ACTIVITY_MODULES[a.id]) expect(EXTRA_MODULES, `${a.id}:${m}`).toContain(m)
    }
  })

  it('الاسم العربي للنشاط هو اسم التطبيق', () => {
    expect(activityLabel('grocery')).toBe('أغذية / سوبر ماركت')
    expect(activityLabel('cars')).toBe('معرض سيارات (بيع وإيجار)')
  })

  it('القسم غير المضمّن في النشاط يبقى قابلاً للإضافة بمفتاح (السيارات + نقطة البيع)', () => {
    // قالب التطبيق للسيارات = السيارات + تأجير المعدات + الأقساط فقط
    expect(modulesIncludedInActivity('cars')).not.toContain('pos')
    const split = splitModules({ activityId: 'cars', owned: [] })
    expect(split.addable).toContain('pos')
    expect(split.addable).toContain('inventory')
    expect(split.included).not.toContain('pos')
  })
})
