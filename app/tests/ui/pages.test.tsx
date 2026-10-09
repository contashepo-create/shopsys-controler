// @vitest-environment jsdom
/**
 * اختبارات واجهة للصفحات: الإشعارات (سجل/تعديل/حذف/القراءة) والعملاء (فتح وإغلاق الإصدار).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { CustomerView } from '../../src/core/customers.ts'
import type { SentNotice } from '../../src/core/notices.ts'

const m = vi.hoisted(() => ({
  issueLicense: vi.fn(), lookupDevice: vi.fn(), readGlobalDefaults: vi.fn(), sendKeyToCustomer: vi.fn(),
  listSentNotices: vi.fn(), editNotice: vi.fn(), deleteNotice: vi.fn(), sendNotice: vi.fn(),
  readCloudFlags: vi.fn(), setCloudFlag: vi.fn(),
}))
const ca = vi.hoisted(() => ({ deactivateCustomer: vi.fn() }))
vi.mock('../../src/data/actions.ts', () => m)
vi.mock('../../src/data/customerActions.ts', () => ca)

const { NotificationsPage } = await import('../../src/ui/pages/NotificationsPage.tsx')
const { CustomersPage } = await import('../../src/ui/pages/CustomersPage.tsx')
const { ToastProvider } = await import('../../src/ui/components/ui.tsx')
const { useDataStore } = await import('../../src/stores/data.store.ts')
const { expiresAfterDays } = await import('../../src/core/license.ts')

function cust(id: string, name: string, over: Partial<CustomerView> = {}): CustomerView {
  return {
    deviceId: id, customer: name, email: null, plan: 'basic', expiresAt: expiresAfterDays(60), activityId: 'grocery', clientActivityId: 'grocery',
    features: [], extraUsers: 0, extraBranches: 0, extraModules: [], fingerprint: 'abcd1234', licenseKey: 'SHOPSYS1.k.s', licenseIssuedAt: '2026-09-01',
    lastSeenAt: null, status: 'active', lastActivityAt: null, lastSupportAt: null, message: '', ...over,
  }
}
const A = 'SHOP-AAAA-AAAA-AAAA'
const B = 'SHOP-BBBB-BBBB-BBBB'
const C = 'SHOP-CCCC-CCCC-CCCC'

function notice(id: string, over: Partial<SentNotice['notice']> = {}, scope: SentNotice['scope'] = 'devices', deviceIds = [A, B]): SentNotice {
  return {
    notice: { id, title: `عنوان ${id}`, body: `نص ${id}`, createdAt: '2026-10-05T10:00:00Z', expiresAt: new Date(Date.now() + 10 * 86400000).toISOString(), ...over },
    scope, deviceIds, listKeys: scope === 'global' ? ['notices:global'] : deviceIds.map((d) => `notices:${d}`),
  }
}

const refresh = vi.fn(async () => {})
beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset()
  ca.deactivateCustomer.mockReset()
  refresh.mockClear()
  m.readGlobalDefaults.mockResolvedValue({ plan: 'basic', days: 365, features: [], extraUsers: 0, extraBranches: 0, extraModules: [] })
  m.readCloudFlags.mockResolvedValue({ disabledFeatures: [], noteAr: '' })
  m.lookupDevice.mockResolvedValue(null)
  useDataStore.setState({
    customers: [
      cust(A, 'أحمد', { lastSeenAt: '2026-10-06T00:00:00Z' }),
      cust(B, 'بسمة', { lastSeenAt: '2026-10-01T00:00:00Z', clientActivityId: 'pharmacy', activityId: 'pharmacy' }),
      cust(C, 'كريم', { status: 'revoked' }),
    ],
    refresh, loading: false, servicesAvailable: true,
  })
})
afterEach(() => cleanup())

const renderPage = (el: React.ReactNode) => render(<MemoryRouter><ToastProvider>{el}</ToastProvider></MemoryRouter>)
const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLTableRowElement

describe('صفحة الإشعارات', () => {
  it('السجل الكامل مع عدّاد القراءة: قرأه / وصله / لم يصله', async () => {
    m.listSentNotices.mockResolvedValue({ notices: [notice('n1')], readsByDevice: new Map([[A, { n1: '2026-10-06T08:00:00Z' }]]) })
    renderPage(<NotificationsPage />)
    const row = await screen.findByText('عنوان n1').then((el) => el.closest('tr')!)
    expect(row.textContent).toContain('✅ 1')
    expect(row.textContent).toContain('📥 0')
    expect(row.textContent).toContain('⏳ 1')
    expect(row.textContent).toContain('2 عميل')
    // تفاصيل المستلمين بالأسماء
    await userEvent.click(within(row).getByTitle('عرض المستلمين'))
    const dialog = screen.getByText(/من قرأ «عنوان n1»/).closest('.modal') as HTMLElement
    expect(within(dialog).getByText('أحمد').closest('tr')!.textContent).toContain('قرأه')
    expect(within(dialog).getByText('بسمة').closest('tr')!.textContent).toContain('لم يصله بعد')
  })

  it('الحذف بعد التأكيد: يستدعي الحذف مرة ويختفي من الجدول دون إعادة تحميل كل السجل', async () => {
    const user = userEvent.setup()
    m.listSentNotices.mockResolvedValue({ notices: [notice('n1'), notice('n2')], readsByDevice: new Map() })
    m.deleteNotice.mockResolvedValue(undefined)
    renderPage(<NotificationsPage />)
    await user.click(within((await screen.findByText('عنوان n1')).closest('tr')!).getByRole('button', { name: /حذف/ }))
    // نافذة التأكيد — الإلغاء لا يحذف
    await user.click(screen.getByRole('button', { name: 'إلغاء' }))
    expect(m.deleteNotice).not.toHaveBeenCalled()
    await user.click(within(screen.getByText('عنوان n1').closest('tr')!).getByRole('button', { name: /حذف/ }))
    const confirm = screen.getByText('حذف الإشعار').closest('.modal') as HTMLElement
    await user.click(within(confirm).getByRole('button', { name: /حذف/ }))
    await waitFor(() => expect(screen.queryByText('عنوان n1')).toBeNull())
    expect(m.deleteNotice).toHaveBeenCalledTimes(1)
    expect(m.deleteNotice.mock.calls[0][0].notice.id).toBe('n1')
    expect(screen.getByText('عنوان n2')).toBeTruthy()
    expect(m.listSentNotices).toHaveBeenCalledTimes(1)
  })

  it('التعديل: يحفظ النص الجديد ويحدّث الصف محلياً مع شارة «معدّل»، والمدة دون تغيير تُبقي تاريخ الانتهاء', async () => {
    const user = userEvent.setup()
    const original = notice('n1')
    m.listSentNotices.mockResolvedValue({ notices: [original], readsByDevice: new Map() })
    m.editNotice.mockResolvedValue(undefined)
    renderPage(<NotificationsPage />)
    await user.click(within((await screen.findByText('عنوان n1')).closest('tr')!).getByRole('button', { name: /تعديل/ }))
    const dialog = screen.getByText('تعديل الإشعار').closest('.modal') as HTMLElement
    const textarea = dialog.querySelector('textarea')!
    await user.clear(textarea)
    await user.type(textarea, 'نص بعد التعديل')
    await user.click(within(dialog).getByRole('button', { name: 'حفظ التعديل' }))
    await waitFor(() => expect(m.editNotice).toHaveBeenCalledTimes(1))
    const [sentArg, patch] = m.editNotice.mock.calls[0]
    expect(sentArg.notice.id).toBe('n1')
    expect(patch.body).toBe('نص بعد التعديل')
    expect(patch.expiresAt ?? original.notice.expiresAt).toBe(original.notice.expiresAt)
    await waitFor(() => expect(screen.queryByText('تعديل الإشعار')).toBeNull())
    const row = screen.getByText('نص بعد التعديل').closest('tr')!
    expect(row.textContent).toContain('معدّل')
    expect(m.listSentNotices).toHaveBeenCalledTimes(1)
  })

  it('تغيير مدة الظهور في التعديل يرسل تاريخ انتهاء جديداً', async () => {
    const user = userEvent.setup()
    m.listSentNotices.mockResolvedValue({ notices: [notice('n1')], readsByDevice: new Map() })
    m.editNotice.mockResolvedValue(undefined)
    renderPage(<NotificationsPage />)
    await user.click(within((await screen.findByText('عنوان n1')).closest('tr')!).getByRole('button', { name: /تعديل/ }))
    const dialog = screen.getByText('تعديل الإشعار').closest('.modal') as HTMLElement
    const daysInput = within(dialog).getByText(/يبقى ظاهراً/).closest('.field')!.querySelector('input')!
    await user.clear(daysInput)
    await user.type(daysInput, '3')
    await user.click(within(dialog).getByRole('button', { name: 'حفظ التعديل' }))
    await waitFor(() => expect(m.editNotice).toHaveBeenCalledTimes(1))
    const exp = Date.parse(m.editNotice.mock.calls[0][1].expiresAt)
    expect(Math.round((exp - Date.now()) / 86400000)).toBe(3)
  })

  it('التعديل بنص قصير جداً يُرفض قبل أي كتابة', async () => {
    const user = userEvent.setup()
    m.listSentNotices.mockResolvedValue({ notices: [notice('n1')], readsByDevice: new Map() })
    renderPage(<NotificationsPage />)
    await user.click(within((await screen.findByText('عنوان n1')).closest('tr')!).getByRole('button', { name: /تعديل/ }))
    const textarea = document.querySelector('.modal textarea') as HTMLTextAreaElement
    await user.clear(textarea)
    await user.type(textarea, 'ab')
    await user.click(screen.getByRole('button', { name: 'حفظ التعديل' }))
    expect(await screen.findByText('نص الإشعار قصير جداً')).toBeTruthy()
    expect(m.editNotice).not.toHaveBeenCalled()
  })

  it('الاستهداف بالنشاط يعرض الاسم العربي وعدد العملاء ويرسل للنشاط الصحيح', async () => {
    const user = userEvent.setup()
    m.listSentNotices.mockResolvedValue({ notices: [], readsByDevice: new Map() })
    m.sendNotice.mockResolvedValue({ targets: 1, mode: 'devices' })
    renderPage(<NotificationsPage />)
    await user.click(screen.getByRole('button', { name: 'نشاط معين' }))
    await user.click(screen.getByRole('button', { name: 'صيدلية (1)' }))
    expect(screen.getByText(/سيصل إلى/).textContent).toContain('نشاط «صيدلية» (1 عميل)')
    await user.type(document.querySelector('textarea')!, 'عرض خاص للصيدليات')
    await user.click(screen.getByRole('button', { name: 'إرسال الإشعار' }))
    await waitFor(() => expect(m.sendNotice).toHaveBeenCalledTimes(1))
    expect(m.sendNotice.mock.calls[0][0].targeting).toEqual({ type: 'activity', activityId: 'pharmacy' })
  })

  it('فشل تحميل السجل يظهر رسالة ولا يكسر الصفحة', async () => {
    m.listSentNotices.mockRejectedValue(new Error('تجاوزت حد طلبات Cloudflare'))
    renderPage(<NotificationsPage />)
    expect(await screen.findByText('تجاوزت حد طلبات Cloudflare')).toBeTruthy()
    expect(screen.getByText('لا إشعارات مرسلة')).toBeTruthy()
  })
})

describe('صفحة العملاء', () => {
  it('«✏️ تعديل» من الصف ثم إلغاء → يعود للقائمة مباشرة (لا تفتح بطاقة العميل)', async () => {
    const user = userEvent.setup()
    renderPage(<CustomersPage />)
    await user.click(within(rowOf('أحمد')).getByRole('button', { name: /تعديل/ }))
    expect(screen.getByText(/تعديل اشتراك — أحمد/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'إلغاء' }))
    expect(screen.queryByText(/تعديل اشتراك — أحمد/)).toBeNull()
    expect(screen.queryByRole('button', { name: /تعديل \/ إضافة قسم أو ميزة/ })).toBeNull()
  })

  it('من بطاقة العميل ثم إلغاء → يعود للبطاقة', async () => {
    const user = userEvent.setup()
    renderPage(<CustomersPage />)
    await user.click(rowOf('أحمد'))
    await user.click(screen.getByRole('button', { name: /تعديل \/ إضافة قسم أو ميزة/ }))
    expect(screen.getByText(/تعديل اشتراك — أحمد/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'إلغاء' }))
    expect(screen.getByRole('button', { name: /تعديل \/ إضافة قسم أو ميزة/ })).toBeTruthy()
  })

  it('العميل المعطّل يظهر بزر «تنشيط» ويفتح نافذة التنشيط', async () => {
    const user = userEvent.setup()
    renderPage(<CustomersPage />)
    await user.click(within(rowOf('كريم')).getByRole('button', { name: /تنشيط/ }))
    expect(screen.getByText(/تنشيط العميل — كريم/)).toBeTruthy()
  })

  it('بعد الإصدار من الصف يبقى المفتاح ظاهراً حتى يضغط «تم» (لا يُغلق فوراً)', async () => {
    const user = userEvent.setup()
    m.issueLicense.mockResolvedValue({ key: 'SHOPSYS1.fresh.key', fingerprint: 'ffff0002', payload: {}, notes: [] })
    renderPage(<CustomersPage />)
    await user.click(within(rowOf('أحمد')).getByRole('button', { name: /تعديل/ }))
    await user.click(await screen.findByRole('button', { name: 'إصدار المفتاح المعدَّل' }))
    expect(await screen.findByText('SHOPSYS1.fresh.key')).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'تم' }))
    expect(screen.queryByText('SHOPSYS1.fresh.key')).toBeNull()
  })

  it('التعطيل يطلب تأكيداً ثم يستدعي التعطيل للعميل الصحيح', async () => {
    const user = userEvent.setup()
    ca.deactivateCustomer.mockResolvedValue({ notes: [] })
    renderPage(<CustomersPage />)
    await user.click(rowOf('أحمد'))
    await user.click(screen.getByRole('button', { name: '🔥 تعطيل' }))
    const confirm = screen.getByText('تعطيل العميل').closest('.modal') as HTMLElement
    await user.click(within(confirm).getByRole('button', { name: '🔥 تعطيل' }))
    await waitFor(() => expect(ca.deactivateCustomer).toHaveBeenCalledTimes(1))
    expect(ca.deactivateCustomer.mock.calls[0][0].deviceId).toBe(A)
  })

  it('البحث باسم النشاط العربي يصفّي القائمة', async () => {
    const user = userEvent.setup()
    renderPage(<CustomersPage />)
    await user.type(screen.getByPlaceholderText(/بحث بالاسم/), 'صيدلية')
    expect(screen.queryByText('أحمد')).toBeNull()
    expect(screen.getByText('بسمة')).toBeTruthy()
  })
})
