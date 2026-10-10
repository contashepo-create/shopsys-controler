// @vitest-environment jsdom
/**
 * اختبارات واجهة لنموذج الإصدار الموحّد: نرسم المكوّن الحقيقي في متصفح محاكى (jsdom)
 * ونتعامل معه كما يفعل المطوّر (كتابة / نقر / اختيار)، ثم نفحص ما يُرسل للتوقيع حرفياً.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CustomerView } from '../../src/core/customers.ts'
import type { GlobalDefaults } from '../../src/core/issueForm.ts'

const m = vi.hoisted(() => ({
  issueLicense: vi.fn(),
  lookupDevice: vi.fn(),
  readGlobalDefaults: vi.fn(),
  sendKeyToCustomer: vi.fn(),
}))
vi.mock('../../src/data/actions.ts', () => m)

const { IssueForm } = await import('../../src/ui/components/IssueForm.tsx')
const { ToastProvider } = await import('../../src/ui/components/ui.tsx')
const { useDataStore } = await import('../../src/stores/data.store.ts')
const { expiresAfterDays } = await import('../../src/core/license.ts')

const DEV = 'SHOP-AB12-CD34-EF56'
const today = () => new Date().toISOString().slice(0, 10)

function customer(over: Partial<CustomerView> = {}): CustomerView {
  return {
    deviceId: DEV, customer: 'بقالة النور', email: null, plan: 'pro', expiresAt: expiresAfterDays(40), activityId: 'grocery',
    clientActivityId: 'grocery', features: ['multi_branch', 'cloud_sync'], extraUsers: 0, extraBranches: 0, extraModules: ['cars'],
    fingerprint: 'abcd1234', licenseKey: 'SHOPSYS1.old.key', licenseIssuedAt: '2026-09-01', lastSeenAt: null, status: 'active',
    lastActivityAt: null, lastSupportAt: null, message: '', ...over,
  }
}

const DEFAULTS: GlobalDefaults = { plan: 'pro', days: 90, features: ['telegram_bot'], extraUsers: 0, extraBranches: 0, extraModules: ['lab'] }

function issuedResult() {
  return { key: 'SHOPSYS1.new.key', fingerprint: 'ffff0001', payload: {}, notes: [] }
}

function renderForm(props: Parameters<typeof IssueForm>[0] = {}) {
  return render(<ToastProvider><IssueForm {...props} /></ToastProvider>)
}

/** الحقل حسب نص عنوانه (العناوين في المشروع غير مربوطة بـ htmlFor) */
function fieldOf(labelText: string | RegExp): HTMLElement {
  const label = screen.getAllByText(labelText, { selector: 'label' })[0]
  return label.closest('.field') as HTMLElement
}
const inputOf = (label: string | RegExp) => within(fieldOf(label)).getAllByRole('textbox')[0] as HTMLInputElement
const selectOf = (label: string | RegExp) => within(fieldOf(label)).getByRole('combobox') as HTMLSelectElement
/** شريحة اختيار (ميزة/قسم) بالاسم العربي */
const chip = (name: string) => screen.getByText(name, { selector: '.chip-check span' }).closest('label') as HTMLLabelElement
const chipBox = (name: string) => within(chip(name)).getByRole('checkbox') as HTMLInputElement
const submitBtn = () => screen.getByRole('button', { name: /إصدار المفتاح|تنشيط العميل|إصدار المفتاح المعدَّل/ })

beforeEach(() => {
  m.issueLicense.mockReset().mockResolvedValue(issuedResult())
  m.lookupDevice.mockReset().mockResolvedValue(null)
  m.readGlobalDefaults.mockReset().mockResolvedValue(DEFAULTS)
  m.sendKeyToCustomer.mockReset().mockResolvedValue(undefined)
  useDataStore.setState({ customers: [] })
})
afterEach(() => cleanup())

describe('جهاز جديد (صفحة إصدار المفاتيح)', () => {
  it('يُعبّأ من الافتراضيات، لا يسمح بالإصدار بلا اسم، ويرسل للتوقيع الحمولة الصحيحة', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByPlaceholderText('SHOP-XXXX-XXXX-XXXX'), DEV.toLowerCase())
    expect(await screen.findByText(/جهاز جديد — عُبّئ النموذج من الافتراضيات/)).toBeTruthy()
    expect(m.lookupDevice).toHaveBeenLastCalledWith(DEV)

    // الافتراضيات: احترافي 90 يوماً + بوت تليجرام + قسم المختبر
    await waitFor(() => expect(selectOf('الباقة').value).toBe('pro'))
    expect(inputOf('المدة (أيام)').value).toBe('90')
    expect(chipBox('بوت تليجرام').checked).toBe(true)
    expect(chipBox('المختبر').checked).toBe(true)
    // «تعدد الفروع» ليس خانة اختيار — يُشتق من عدد الفروع
    expect(screen.queryByText('تعدد الفروع', { selector: '.chip-check span' })).toBeNull()
    expect(fieldOf(/فروع إضافية/).textContent).toContain('تعدد الفروع يُفعَّل تلقائياً')

    expect((submitBtn() as HTMLButtonElement).disabled).toBe(true)
    await user.type(inputOf('اسم العميل *'), 'صيدلية الأمل')
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(false)
    await user.click(submitBtn())

    await waitFor(() => expect(m.issueLicense).toHaveBeenCalledTimes(1))
    const [input, opts] = m.issueLicense.mock.calls[0]
    expect(input).toMatchObject({ deviceId: DEV, customer: 'صيدلية الأمل', plan: 'pro', days: 90, activityId: undefined, extraModules: ['lab'], extraBranches: 0, extraUsers: 0 })
    expect([...input.features].sort()).toEqual(['multi_branch', 'telegram_bot'])
    expect(opts).toEqual({ renew: false, burnFingerprint: null })
  })

  it('بعد الإصدار: يظهر المفتاح، وزر الإرسال يضعه في إشعارات العميل مرة واحدة', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByPlaceholderText('SHOP-XXXX-XXXX-XXXX'), DEV)
    await screen.findByText(/جهاز جديد/)
    await user.type(inputOf('اسم العميل *'), 'عميل')
    await user.click(submitBtn())
    expect(await screen.findByText('SHOPSYS1.new.key')).toBeTruthy()
    const send = screen.getByRole('button', { name: /أرسل المفتاح للعميل/ })
    await user.click(send)
    await waitFor(() => expect(m.sendKeyToCustomer).toHaveBeenCalledTimes(1))
    expect(m.sendKeyToCustomer.mock.calls[0][0]).toMatchObject({ deviceId: DEV, customer: 'عميل', key: 'SHOPSYS1.new.key', fingerprint: 'ffff0001' })
    expect((screen.getByRole('button', { name: /أُرسل للعميل/ }) as HTMLButtonElement).disabled).toBe(true)
    // «إصدار مفتاح آخر» يعيد نموذجاً فارغاً
    await user.click(screen.getByRole('button', { name: 'إصدار مفتاح آخر' }))
    expect((screen.getByPlaceholderText('SHOP-XXXX-XXXX-XXXX') as HTMLInputElement).value).toBe('')
  })

  it('كتابة معرّف عميل موجود: يُكتب اسمه ونشاطه وتاريخه تلقائياً من السحابة', async () => {
    const user = userEvent.setup()
    m.lookupDevice.mockResolvedValue(customer({ clientActivityId: 'pharmacy', activityId: 'pharmacy', expiresAt: expiresAfterDays(25) }))
    renderForm()
    await user.type(screen.getByPlaceholderText('SHOP-XXXX-XXXX-XXXX'), DEV)
    expect(await screen.findByText(/عميل مسجَّل — بقالة النور/)).toBeTruthy()
    await waitFor(() => expect(inputOf('اسم العميل *').value).toBe('بقالة النور'))
    expect(selectOf('النشاط').value).toBe('pharmacy')
    expect(inputOf('المدة (أيام)').value).toBe('25')
    expect(fieldOf('المدة (أيام)').textContent).toContain('نفس تاريخه الحالي')
  })

  it('فشل قراءة الافتراضيات لا يعطّل النموذج (يسقط لأساسي 365 يوماً)', async () => {
    const user = userEvent.setup()
    m.readGlobalDefaults.mockRejectedValue(new Error('offline'))
    renderForm()
    await user.type(screen.getByPlaceholderText('SHOP-XXXX-XXXX-XXXX'), DEV)
    await screen.findByText(/جهاز جديد/)
    await waitFor(() => expect(selectOf('الباقة').value).toBe('basic'))
    expect(inputOf('المدة (أيام)').value).toBe('365')
  })

  it('معرّف جهاز بصيغة خاطئة: لا بحث ولا إصدار', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByPlaceholderText('SHOP-XXXX-XXXX-XXXX'), 'SHOP-123')
    expect(m.lookupDevice).not.toHaveBeenCalled()
    await user.type(inputOf('اسم العميل *'), 'x')
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('عميل موجود (بطاقة العميل)', () => {
  it('لا إخفاء للأقسام: الافتراضية من النشاط ظاهرة مفعّلة ولا تُسحب، وكل قسم آخر قابل للمنح', async () => {
    renderForm({ customer: customer() })
    await waitFor(() => expect(inputOf('اسم العميل *').value).toBe('بقالة النور'))
    // أغذية/سوبر ماركت تتضمن نقطة البيع والمخزون (قالب التطبيق): ظاهرة، مفعّلة، وغير قابلة للإلغاء
    expect(screen.getAllByText('نقطة البيع', { selector: '.chip-check span' })).toHaveLength(1)
    expect(chipBox('نقطة البيع').checked).toBe(true)
    expect(chipBox('نقطة البيع').disabled).toBe(true)
    expect(chipBox('المخزون').disabled).toBe(true)
    expect(chip('نقطة البيع').textContent).toContain('افتراضي في النشاط')
    // السيارات عنده ولا يتبع النشاط → قابل للسحب بالعلامة
    expect(chipBox('السيارات').checked).toBe(true)
    expect(chipBox('السيارات').disabled).toBe(false)
    // قسم غير مملوك ولا افتراضي يبقى قابلاً للمنح
    expect(chipBox('المختبر').disabled).toBe(false)
    expect(screen.queryByText(/إظهار كل الأقسام/)).toBeNull()
  })

  it('الإبقاء على كل شيء = نفس تاريخ الانتهاء ونفس الأقسام والميزات (لا شيء يُسحب بالخطأ)', async () => {
    const user = userEvent.setup()
    const c = customer()
    renderForm({ customer: c })
    await waitFor(() => expect(inputOf('المدة (أيام)').value).toBe('40'))
    await user.click(screen.getByRole('button', { name: 'إصدار المفتاح المعدَّل' }))
    await waitFor(() => expect(m.issueLicense).toHaveBeenCalled())
    const [input, opts] = m.issueLicense.mock.calls[0]
    expect(expiresAfterDays(input.days)).toBe(c.expiresAt)
    expect(input.extraModules).toEqual(['cars'])
    expect([...input.features].sort()).toEqual(['cloud_sync', 'multi_branch'])
    expect(input.activityId).toBe('grocery')
    expect(opts).toEqual({ renew: true, burnFingerprint: null })
  })

  it('إزالة قسم يملكه: يُعلَّم «سيُسحب» ويظهر في الملخص بالسالب ولا يُرسل للتوقيع', async () => {
    const user = userEvent.setup()
    renderForm({ customer: customer() })
    await waitFor(() => expect(chipBox('السيارات').checked).toBe(true))
    await user.click(chipBox('السيارات'))
    expect(chip('السيارات').textContent).toContain('سيُسحب')
    expect(screen.getByText(/الملخص:/).parentElement!.textContent).toContain('− السيارات')
    await user.click(submitBtn())
    await waitFor(() => expect(m.issueLicense).toHaveBeenCalled())
    expect(m.issueLicense.mock.calls[0][0].extraModules).toEqual([])
  })

  it('إضافة قسم جديد: يظهر في الملخص بالموجب ويُوقَّع مع ما عنده بلا تكرار', async () => {
    const user = userEvent.setup()
    renderForm({ customer: customer() })
    await waitFor(() => expect(chipBox('السيارات').checked).toBe(true))
    await user.click(chipBox('الأقساط'))
    expect(screen.getByText(/الملخص:/).parentElement!.textContent).toContain('+ الأقساط')
    await user.click(submitBtn())
    await waitFor(() => expect(m.issueLicense).toHaveBeenCalled())
    expect([...m.issueLicense.mock.calls[0][0].extraModules].sort()).toEqual(['cars', 'installments'])
  })

  it('الخفض من احترافي لأساسي: تحذير صريح بإزالة «تعدد الفروع» ولا يُوقَّع', async () => {
    const user = userEvent.setup()
    renderForm({ customer: customer() })
    await waitFor(() => expect(selectOf('الباقة').value).toBe('pro'))
    expect(screen.queryByText(/سيُزال لأن الحد الكلي فرع واحد/)).toBeNull()
    await user.selectOptions(selectOf('الباقة'), 'basic')
    expect(screen.getByText(/سيُزال لأن الحد الكلي فرع واحد/)).toBeTruthy()
    // فرع إضافي واحد يعيده ويختفي التحذير
    await user.type(inputOf(/فروع إضافية/), '1')
    expect(screen.queryByText(/سيُزال لأن الحد الكلي فرع واحد/)).toBeNull()
    await user.clear(inputOf(/فروع إضافية/))
    await user.click(submitBtn())
    await waitFor(() => expect(m.issueLicense).toHaveBeenCalled())
    expect(m.issueLicense.mock.calls[0][0].features).toEqual(['cloud_sync'])
  })

  it('تغيير النشاط لصيدلية: «السيارات» المملوك يبقى، وقسم مختار صار مضمّناً لا يُوقَّع', async () => {
    const user = userEvent.setup()
    renderForm({ customer: customer({ clientActivityId: null, activityId: null, extraModules: ['cars'] }) })
    await waitFor(() => expect(selectOf('النشاط').value).toBe(''))
    // بلا نشاط: نقطة البيع قابلة للإضافة
    await user.click(chipBox('نقطة البيع'))
    await user.selectOptions(selectOf('النشاط'), 'pharmacy')
    // صار افتراضياً في الصيدلية: يبقى ظاهراً مفعّلاً ومقفلاً (لا إخفاء)، ولا يُوقَّع لأنه عند العميل من النشاط
    expect(chipBox('نقطة البيع').checked).toBe(true)
    expect(chipBox('نقطة البيع').disabled).toBe(true)
    await user.click(submitBtn())
    await waitFor(() => expect(m.issueLicense).toHaveBeenCalled())
    const input = m.issueLicense.mock.calls[0][0]
    expect(input.activityId).toBe('pharmacy')
    expect(input.extraModules).toEqual(['cars'])
  })

  it('عميل معطّل ما زال له وقت: يحتفظ بتاريخه، الزر «تنشيط العميل»، ولا خيار حرق', async () => {
    renderForm({ customer: customer({ status: 'revoked', expiresAt: expiresAfterDays(12) }) })
    await waitFor(() => expect(inputOf('المدة (أيام)').value).toBe('12'))
    expect(screen.getByRole('button', { name: 'تنشيط العميل' })).toBeTruthy()
    expect(screen.queryByText(/حرق المفتاح السابق/)).toBeNull()
  })

  it('عميل منتهٍ: المدة من الافتراضيات، وزر «إبقاء تاريخه» غير موجود', async () => {
    renderForm({ customer: customer({ status: 'expired', expiresAt: '2020-01-01' }) })
    await waitFor(() => expect(inputOf('المدة (أيام)').value).toBe('90'))
    expect(screen.queryByRole('button', { name: /إبقاء تاريخه/ })).toBeNull()
  })

  it('أزرار المدة السريعة تغيّر التاريخ، و«إبقاء تاريخه» يعيده', async () => {
    const user = userEvent.setup()
    const c = customer({ expiresAt: expiresAfterDays(40) })
    renderForm({ customer: c })
    await waitFor(() => expect(inputOf('المدة (أيام)').value).toBe('40'))
    await user.click(screen.getByRole('button', { name: 'سنة' }))
    expect(inputOf('المدة (أيام)').value).toBe('365')
    expect(fieldOf('المدة (أيام)').textContent).toContain(`ينتهي في ${expiresAfterDays(365)}`)
    await user.click(screen.getByRole('button', { name: /إبقاء تاريخه/ }))
    expect(inputOf('المدة (أيام)').value).toBe('40')
    expect(fieldOf('المدة (أيام)').textContent).toContain('نفس تاريخه الحالي')
  })

  it('مدى الحياة: زر «مدى الحياة» يُرسل days=0 (بلا انتهاء) — لا يتحول إلى 365 يوماً', async () => {
    const user = userEvent.setup()
    renderForm({ customer: customer({ expiresAt: expiresAfterDays(40) }) })
    await waitFor(() => expect(inputOf('المدة (أيام)').value).toBe('40'))
    await user.click(screen.getByRole('button', { name: 'مدى الحياة' }))
    expect(inputOf('المدة (أيام)').value).toBe('0')
    expect(fieldOf('المدة (أيام)').textContent).toContain('بلا تاريخ انتهاء')
    await user.click(submitBtn())
    await waitFor(() => expect(m.issueLicense).toHaveBeenCalledTimes(1))
    expect(m.issueLicense.mock.calls[0][0]).toMatchObject({ days: 0 })
  })

  it('تاريخ انتهاء محدد: يضبط المدة بالأيام، والتاريخ اليوم أو الماضي مرفوض', async () => {
    renderForm({ customer: customer({ expiresAt: expiresAfterDays(40) }) })
    await waitFor(() => expect(inputOf('المدة (أيام)').value).toBe('40'))
    const dateInput = () => fieldOf('المدة (أيام)').querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(dateInput(), { target: { value: expiresAfterDays(100) } })
    expect(inputOf('المدة (أيام)').value).toBe('100')
    expect(fieldOf('المدة (أيام)').textContent).toContain(`ينتهي في ${expiresAfterDays(100)}`)
    fireEvent.change(dateInput(), { target: { value: today() } })
    expect(inputOf('المدة (أيام)').value).toBe('100')
  })

  it('حرق المفتاح السابق: لا يُرسل إلا عند تفعيل الخيار صراحة', async () => {
    const user = userEvent.setup()
    renderForm({ customer: customer() })
    await waitFor(() => expect(inputOf('اسم العميل *').value).toBe('بقالة النور'))
    await user.click(screen.getByText(/حرق المفتاح السابق/).closest('label')!.querySelector('input')!)
    await user.click(submitBtn())
    await waitFor(() => expect(m.issueLicense).toHaveBeenCalled())
    expect(m.issueLicense.mock.calls[0][1]).toEqual({ renew: true, burnFingerprint: 'abcd1234' })
  })

  it('خطأ التوقيع يظهر للمطوّر ويبقى النموذج بقيمه', async () => {
    const user = userEvent.setup()
    m.issueLicense.mockRejectedValue(new Error('المفتاح الخاص غير مستورد'))
    renderForm({ customer: customer() })
    await waitFor(() => expect(inputOf('اسم العميل *').value).toBe('بقالة النور'))
    await user.click(submitBtn())
    expect(await screen.findByText('المفتاح الخاص غير مستورد')).toBeTruthy()
    expect(inputOf('اسم العميل *').value).toBe('بقالة النور')
  })

  it('ميزة مستقبلية في المفتاح الحالي لا تعرفها اللوحة تُحفظ عند إعادة الإصدار', async () => {
    const user = userEvent.setup()
    renderForm({ customer: customer({ features: ['cloud_sync', 'future_x' as never] }) })
    await waitFor(() => expect(inputOf('اسم العميل *').value).toBe('بقالة النور'))
    await user.click(submitBtn())
    await waitFor(() => expect(m.issueLicense).toHaveBeenCalled())
    expect(m.issueLicense.mock.calls[0][0].features).toContain('future_x')
  })
})

describe('قائمة النشاط', () => {
  it('النشاط اليدوي يُرسل حرفياً بحالة أحرفه (carParts)', async () => {
    const user = userEvent.setup()
    renderForm({ customer: customer() })
    await waitFor(() => expect(selectOf('النشاط').value).toBe('grocery'))
    await user.selectOptions(selectOf('النشاط'), '__custom__')
    const custom = screen.getByPlaceholderText(/اكتبه كما في تطبيق العميل/) as HTMLInputElement
    fireEvent.change(custom, { target: { value: 'carParts' } })
    expect(custom.value).toBe('carParts')
    expect(screen.getByText(/مختلف عن اختيار العميل/)).toBeTruthy()
    await user.click(submitBtn())
    await waitFor(() => expect(m.issueLicense).toHaveBeenCalled())
    expect(m.issueLicense.mock.calls[0][0].activityId).toBe('carParts')
  })

  it('معرّف نشاط يدوي غير صالح: تنبيه ورفض الإصدار', async () => {
    const user = userEvent.setup()
    renderForm({ customer: customer() })
    await waitFor(() => expect(selectOf('النشاط').value).toBe('grocery'))
    await user.selectOptions(selectOf('النشاط'), '__custom__')
    fireEvent.change(screen.getByPlaceholderText(/اكتبه كما في تطبيق العميل/), { target: { value: 'car"parts' } })
    expect(screen.getByText(/بلا مسافات أو علامات تنصيص/)).toBeTruthy()
    await user.click(submitBtn())
    expect(await screen.findByText('معرّف النشاط غير صالح')).toBeTruthy()
    expect(m.issueLicense).not.toHaveBeenCalled()
  })

  it('زر الرجوع لاختيار العميل يعيد نشاطه', async () => {
    const user = userEvent.setup()
    renderForm({ customer: customer() })
    await waitFor(() => expect(selectOf('النشاط').value).toBe('grocery'))
    await user.selectOptions(selectOf('النشاط'), 'pharmacy')
    await user.click(screen.getByRole('button', { name: /الرجوع لاختيار العميل/ }))
    expect(selectOf('النشاط').value).toBe('grocery')
  })

  it('نشاط عميل غير موجود في الكتالوج يظهر في القائمة ومحدداً', async () => {
    renderForm({ customer: customer({ clientActivityId: 'bookstore', activityId: null }) })
    await waitFor(() => expect(selectOf('النشاط').value).toBe('bookstore'))
    const opts = within(selectOf('النشاط')).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(opts.filter((v) => v === 'bookstore')).toHaveLength(1)
  })
})

describe('صحة التاريخ', () => {
  it('اليوم المستخدم في النموذج هو نفس يوم expiresAfterDays (UTC)', () => {
    expect(expiresAfterDays(0)).toBeNull()
    expect(expiresAfterDays(1, today())).toBe(expiresAfterDays(1))
  })
})
