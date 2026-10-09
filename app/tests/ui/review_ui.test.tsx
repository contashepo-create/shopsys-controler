// @vitest-environment jsdom
/**
 * واجهة — إصلاحات الفحص الخامس: لا نموذج «فارغ» يُحفظ فوق بيانات حقيقية عند فشل القراءة،
 * ولا «جهاز جديد» عند فشل البحث، ونجاح جزئي يُبلَّغ، ونوافذ الإدخال لا تُغلق بنقرة طائشة.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { useState } from 'react'
import type { CustomerView } from '../../src/core/customers.ts'

const m = vi.hoisted(() => ({
  issueLicense: vi.fn(), lookupDevice: vi.fn(), readGlobalDefaults: vi.fn(), sendKeyToCustomer: vi.fn(),
  listSentNotices: vi.fn(), editNotice: vi.fn(), deleteNotice: vi.fn(), sendNotice: vi.fn(),
  readCloudFlags: vi.fn(), setCloudFlag: vi.fn(), revokeLicense: vi.fn(), updateGlobalSettings: vi.fn(),
  updateAbout: vi.fn(), updateVersion: vi.fn(),
}))
const ca = vi.hoisted(() => ({ deactivateCustomer: vi.fn() }))
const b = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../../src/data/actions.ts', () => m)
vi.mock('../../src/data/customerActions.ts', () => ca)
vi.mock('../../src/data/bridge.ts', () => ({ bridge: { cf: { get: b.get } }, isDesktop: () => true, requireDesktop: () => {} }))

const { IssueForm } = await import('../../src/ui/components/IssueForm.tsx')
const { LicensesPage } = await import('../../src/ui/pages/LicensesPage.tsx')
const { ContentPage } = await import('../../src/ui/pages/ContentPage.tsx')
const { CustomersPage } = await import('../../src/ui/pages/CustomersPage.tsx')
const { NotificationsPage } = await import('../../src/ui/pages/NotificationsPage.tsx')
const { ToastProvider, Modal } = await import('../../src/ui/components/ui.tsx')
const { useDataStore } = await import('../../src/stores/data.store.ts')
const { expiresAfterDays } = await import('../../src/core/license.ts')

const DEV = 'SHOP-AB12-CD34-EF56'
const DEFAULTS = { plan: 'pro', days: 90, features: [], extraUsers: 0, extraBranches: 0, extraModules: [] }
function cust(over: Partial<CustomerView> = {}): CustomerView {
  return {
    deviceId: DEV, customer: 'أحمد', email: null, plan: 'basic', expiresAt: expiresAfterDays(60), activityId: 'grocery', clientActivityId: 'grocery',
    features: ['reports'], extraUsers: 0, extraBranches: 0, extraModules: [], fingerprint: 'abcd1234', licenseKey: 'SHOPSYS1.k.s', licenseIssuedAt: '2026-09-01',
    lastSeenAt: null, status: 'active', lastActivityAt: null, lastSupportAt: null, message: '', ...over,
  }
}
const refresh = vi.fn(async () => {})
const renderPage = (el: React.ReactNode) => render(<MemoryRouter><ToastProvider>{el}</ToastProvider></MemoryRouter>)
const toasts = () => document.querySelector('.toast-wrap')?.textContent ?? ''

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset()
  ca.deactivateCustomer.mockReset(); b.get.mockReset(); refresh.mockClear()
  m.readGlobalDefaults.mockResolvedValue(DEFAULTS)
  m.readCloudFlags.mockResolvedValue({ disabledFeatures: [], noteAr: '' })
  m.lookupDevice.mockResolvedValue(null)
  m.listSentNotices.mockResolvedValue({ notices: [], readsByDevice: new Map() })
  useDataStore.setState({ customers: [], refresh, loading: false, servicesAvailable: true, error: null })
})
afterEach(() => cleanup())

describe('نموذج الإصدار: فشل البحث عن الجهاز', () => {
  it('خطأ + «إعادة المحاولة» + الإصدار معطّل (لا يُعامل كجهاز جديد بالافتراضيات)', async () => {
    const user = userEvent.setup()
    m.lookupDevice.mockRejectedValueOnce(new Error('تجاوزت حد طلبات Cloudflare'))
    renderPage(<IssueForm />)
    const idBox = screen.getAllByRole('textbox')[0]
    await user.type(idBox, DEV)
    expect(await screen.findByText(/تعذر التحقق من الجهاز/)).toBeTruthy()
    expect(screen.queryByText(/جهاز جديد/)).toBeNull()
    await user.type(screen.getAllByRole('textbox')[1], 'اسم')
    const submit = screen.getByRole('button', { name: /إصدار المفتاح/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    // إعادة المحاولة تنجح هذه المرة → عميل مسجَّل، والنموذج يُعبّأ من اشتراكه
    m.lookupDevice.mockResolvedValueOnce(cust({ extraModules: ['cars'] }))
    await user.click(screen.getByRole('button', { name: 'إعادة المحاولة' }))
    expect(await screen.findByText(/عميل مسجَّل — أحمد/)).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('button', { name: /إصدار المفتاح/ }) as HTMLButtonElement).disabled).toBe(false))
    expect(m.issueLicense).not.toHaveBeenCalled()
  })

  it('فشل قراءة الافتراضيات → قيم آمنة مع تنبيه صريح', async () => {
    const user = userEvent.setup()
    m.readGlobalDefaults.mockRejectedValueOnce(new Error('429'))
    renderPage(<IssueForm />)
    await user.type(screen.getAllByRole('textbox')[0], DEV)
    expect(await screen.findByText(/تعذر قراءة الافتراضيات المحفوظة/)).toBeTruthy()
  })
})

describe('صفحة الافتراضيات', () => {
  it('فشل التحميل → لا نموذج ولا زر حفظ؛ إعادة المحاولة تحمّل القيم الحقيقية', async () => {
    const user = userEvent.setup()
    // كل القراءات تفشل (نموذج الإصدار في التبويب الأول يقرأ أيضاً)
    m.readGlobalDefaults.mockRejectedValue(new Error('تجاوزت حد طلبات Cloudflare'))
    renderPage(<LicensesPage />)
    await user.click(screen.getByRole('button', { name: /افتراضيات الجهاز الجديد/ }))
    expect(await screen.findByText('تعذر قراءة الافتراضيات الحالية')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'حفظ الافتراضيات' })).toBeNull()
    m.readGlobalDefaults.mockResolvedValueOnce({ ...DEFAULTS, plan: 'lifetime' })
    await user.click(screen.getByRole('button', { name: 'إعادة المحاولة' }))
    await user.click(await screen.findByRole('button', { name: 'حفظ الافتراضيات' }))
    expect(m.updateGlobalSettings).toHaveBeenCalledWith(expect.objectContaining({ plan: 'lifetime' }))
  })
})

describe('بحث / حرق', () => {
  const lic = (over: object = {}) => JSON.stringify({ key: 'SHOPSYS1.a.b', payload: { customer: 'أحمد', plan: 'basic', deviceId: DEV }, ...over })
  async function search(user: ReturnType<typeof userEvent.setup>) {
    renderPage(<LicensesPage />)
    await user.click(screen.getByRole('button', { name: /بحث \/ حرق/ }))
    await user.type(screen.getByPlaceholderText(/بصمة 8 خانات/), 'abcd1234')
    await user.click(screen.getByRole('button', { name: 'بحث' }))
  }
  it('علامة revoked في السجل تكفي لإظهار «محروق» حتى لو غاب من القائمة', async () => {
    const user = userEvent.setup()
    b.get.mockImplementation(async (_ns: string, key: string) => ({ ok: true, value: key === 'revoked' ? '[]' : lic({ revoked: true }) }))
    await search(user)
    expect(await screen.findByText('🔥 محروق')).toBeTruthy()
  })
  it('فشل قراءة قائمة الحرق → خطأ بدل شارة «سليم» خاطئة', async () => {
    const user = userEvent.setup()
    b.get.mockImplementation(async (_ns: string, key: string) => (key === 'revoked' ? { ok: false, value: null, error: '429' } : { ok: true, value: lic() }))
    await search(user)
    await waitFor(() => expect(toasts()).toMatch(/تعذر قراءة قائمة الحرق/))
    expect(screen.queryByText('✅ سليم')).toBeNull()
  })
  it('الحرق: ملاحظات غير حاجبة تظهر، والقائمة تُحدَّث؛ فشل النسخ يُبلَّغ', async () => {
    const user = userEvent.setup()
    b.get.mockImplementation(async (_ns: string, key: string) => ({ ok: true, value: key === 'revoked' ? '[]' : lic() }))
    m.revokeLicense.mockResolvedValue({ fingerprint: 'abcd1234', notes: ['مساحة الخدمات غير مضبوطة — حُرق في مساحة التراخيص فقط'] })
    await search(user)
    refresh.mockClear()
    await user.click(await screen.findByRole('button', { name: '🔥 حرق المفتاح' }))
    await waitFor(() => expect(toasts()).toMatch(/مساحة الخدمات غير مضبوطة/))
    expect(refresh).toHaveBeenCalled()
    expect(screen.getByText('🔥 محروق')).toBeTruthy()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })
    await user.click(screen.getByRole('button', { name: 'نسخ المفتاح' }))
    await waitFor(() => expect(toasts()).toMatch(/تعذر النسخ/))
  })
})

describe('«حول» والتحديثات', () => {
  it('فشل قراءة «حول» → الحفظ معطّل مع تنبيه (لا يُكتب نموذج فارغ فوق المحتوى عند كل العملاء)', async () => {
    const user = userEvent.setup()
    b.get.mockImplementation(async (_ns: string, key: string) => (key === 'about' ? { ok: false, value: null, error: '429' } : { ok: true, value: JSON.stringify({ latestVersion: '1.0.0' }) }))
    renderPage(<ContentPage />)
    expect(await screen.findByText(/تعذر قراءة محتوى «حول» الحالي/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'حفظ في الاسمين' }) as HTMLButtonElement).disabled).toBe(true)
    // قسم التحديث قُرئ بنجاح → يعمل
    await user.type(screen.getAllByRole('textbox')[5], '1.0.1')
    expect((screen.getByRole('button', { name: 'نشر التحديث' }) as HTMLButtonElement).disabled).toBe(false)
    // إعادة المحاولة تنجح
    b.get.mockImplementation(async () => ({ ok: true, value: JSON.stringify({ title: 'تحكم', body: 'نص' }) }))
    await user.click(screen.getByRole('button', { name: 'إعادة المحاولة' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'حفظ في الاسمين' }) as HTMLButtonElement).disabled).toBe(false))
    expect(m.updateAbout).not.toHaveBeenCalled()
  })
  it('فشل قراءة إعلان التحديث → النشر معطّل', async () => {
    b.get.mockImplementation(async (_ns: string, key: string) => (key === 'version' ? { ok: false, value: null, error: '500' } : { ok: true, value: null }))
    renderPage(<ContentPage />)
    expect(await screen.findByText(/تعذر قراءة إعلان التحديث الحالي/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'نشر التحديث' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'حفظ في الاسمين' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('بطاقة العميل', () => {
  const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLTableRowElement
  it('أقسام النشاط مرة واحدة، والإضافي فقط بعلامة «إضافي» (لا تكرار)', async () => {
    const user = userEvent.setup()
    useDataStore.setState({ customers: [cust({ extraModules: ['pos', 'cars', 'cars'] })] })
    renderPage(<CustomersPage />)
    await user.click(rowOf('أحمد'))
    const card = screen.getByText('الميزات والأقسام').closest('.card') as HTMLElement
    expect(within(card).getAllByText(/نقطة البيع/)).toHaveLength(1)
    expect(within(card).getAllByText(/السيارات/)).toHaveLength(1)
    expect(within(card).getByText(/السيارات · إضافي/)).toBeTruthy()
  })
  it('فشل قراءة حالة الإطفاء يظهر تحذيراً (لا «كل شيء شغّال» بصمت)', async () => {
    const user = userEvent.setup()
    m.readCloudFlags.mockRejectedValue(new Error('429'))
    useDataStore.setState({ customers: [cust()] })
    renderPage(<CustomersPage />)
    await user.click(rowOf('أحمد'))
    expect(await screen.findByText(/تعذر قراءة حالة الإطفاء الحالية/)).toBeTruthy()
  })
  it('مفتاح منتهٍ → «إرسال للعميل» معطّل؛ فشل النسخ يُبلَّغ', async () => {
    const user = userEvent.setup()
    useDataStore.setState({ customers: [cust({ status: 'expired', expiresAt: '2026-01-01' })] })
    renderPage(<CustomersPage />)
    await user.click(rowOf('أحمد'))
    expect((screen.getByRole('button', { name: /إرسال للعميل/ }) as HTMLButtonElement).disabled).toBe(true)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })
    await user.click(screen.getByRole('button', { name: 'نسخ' }))
    await waitFor(() => expect(toasts()).toMatch(/تعذر النسخ/))
  })
  it('التعطيل يعرض ملاحظات غير حاجبة', async () => {
    const user = userEvent.setup()
    ca.deactivateCustomer.mockResolvedValue({ notes: ['حُرق المفتاح لكن تعذر تعليم سجل الجهاز بالإيقاف'] })
    useDataStore.setState({ customers: [cust()] })
    renderPage(<CustomersPage />)
    await user.click(rowOf('أحمد'))
    await user.click(screen.getByRole('button', { name: '🔥 تعطيل' }))
    const confirm = screen.getByText('تعطيل العميل').closest('.modal') as HTMLElement
    await user.click(within(confirm).getByRole('button', { name: '🔥 تعطيل' }))
    await waitFor(() => expect(toasts()).toMatch(/تم تعطيل العميل/))
    await waitFor(() => expect(toasts()).toMatch(/تعذر تعليم سجل الجهاز/))
  })
})

describe('الإشعارات: نجاح جزئي', () => {
  it('يُبلَّغ بالأجهزة التي فشلت ولا يُمسح النص (لإعادة الإرسال لها)', async () => {
    const user = userEvent.setup()
    useDataStore.setState({ customers: [cust(), cust({ deviceId: 'SHOP-BBBB-BBBB-BBBB', customer: 'بسمة' })] })
    m.sendNotice.mockResolvedValue({ targets: 1, mode: 'devices', failed: ['SHOP-BBBB-BBBB-BBBB'] })
    renderPage(<NotificationsPage />)
    const body = screen.getByPlaceholderText(/تم إصدار تحديث جديد/) as HTMLTextAreaElement
    await user.type(body, 'صيانة الخادم الليلة')
    await user.click(screen.getByRole('button', { name: 'إرسال الإشعار' }))
    await waitFor(() => expect(toasts()).toMatch(/تعذر الإرسال إلى 1 جهاز: SHOP-BBBB-BBBB-BBBB/))
    expect(body.value).toBe('صيانة الخادم الليلة')
  })
})

describe('Modal', () => {
  function Harness(props: { dismissible?: boolean }) {
    const [open, setOpen] = useState(true)
    return open ? <Modal open title="نافذة" dismissible={props.dismissible} onClose={() => setOpen(false)}><input aria-label="حقل" /></Modal> : <span>مغلقة</span>
  }
  const backdrop = () => document.querySelector('.modal-backdrop') as HTMLElement
  it('نافذة إدخال (dismissible=false) لا تُغلق بالنقر خارجها', () => {
    render(<Harness dismissible={false} />)
    fireEvent.mouseDown(backdrop()); fireEvent.click(backdrop())
    expect(screen.getByLabelText('حقل')).toBeTruthy()
  })
  it('سحب تحديد من داخل النافذة وإفلاته خارجها لا يغلقها؛ نقرة حقيقية على الخلفية تغلق', () => {
    render(<Harness />)
    fireEvent.mouseDown(screen.getByLabelText('حقل'))
    fireEvent.click(backdrop())
    expect(screen.getByLabelText('حقل')).toBeTruthy()
    fireEvent.mouseDown(backdrop()); fireEvent.click(backdrop())
    expect(screen.getByText('مغلقة')).toBeTruthy()
  })
})
