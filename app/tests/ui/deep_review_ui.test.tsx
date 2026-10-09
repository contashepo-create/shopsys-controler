// @vitest-environment jsdom
/**
 * واجهة — الفحص السادس: شاشة القفل (كلمة خاطئة لا تفتح، والاستعادة لا تهدر محاولات)،
 * تغيير كلمة المرور من الإعدادات، سجل التدقيق، وصفحة الدعم (علامات «جديد» وسباق التذاكر).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { CustomerView } from '../../src/core/customers.ts'

const b = vi.hoisted(() => ({
  verifyPassword: vi.fn(), setPassword: vi.fn(), lock: vi.fn(), requestOtp: vi.fn(), resetWithOtp: vi.fn(),
  status: vi.fn(), auditList: vi.fn(), checkKey: vi.fn(), secretsSet: vi.fn(),
}))
const m = vi.hoisted(() => ({ audit: vi.fn(), readSupportChat: vi.fn(), replySupport: vi.fn() }))
vi.mock('../../src/data/actions.ts', () => m)
vi.mock('../../src/data/bridge.ts', () => ({
  bridge: {
    runtime: 'electron',
    auth: { verifyPassword: b.verifyPassword, setPassword: b.setPassword, lock: b.lock, requestOtp: b.requestOtp, resetWithOtp: b.resetWithOtp },
    secrets: { status: b.status, set: b.secretsSet },
    db: { auditList: b.auditList },
    license: { checkKey: b.checkKey },
  },
  isDesktop: () => true,
  requireDesktop: () => {},
}))

const { LockPage } = await import('../../src/ui/pages/LockPage.tsx')
const { ChangePasswordForm } = await import('../../src/ui/pages/SettingsPage.tsx')
const { AuditPage, formatAuditDetails } = await import('../../src/ui/pages/AuditPage.tsx')
const { SupportPage } = await import('../../src/ui/pages/SupportPage.tsx')
const { ToastProvider } = await import('../../src/ui/components/ui.tsx')
const { useSessionStore } = await import('../../src/stores/session.store.ts')
const { useDataStore } = await import('../../src/stores/data.store.ts')

const renderPage = (el: React.ReactNode) => render(<MemoryRouter><ToastProvider>{el}</ToastProvider></MemoryRouter>)
const toasts = () => document.querySelector('.toast-wrap')?.textContent ?? ''
const input = (label: string) => screen.getByText(label).parentElement!.querySelector('input')!
const STATUS = { hasCfToken: true, hasBotToken: true, hasPrivateKey: true, publicKeyMatches: true, cfAccountId: '', cfNsLicense: '', cfNsServices: '', adminChatId: '123' }

function cust(over: Partial<CustomerView> = {}): CustomerView {
  return {
    deviceId: 'D', customer: 'عميل', email: null, plan: 'pro', expiresAt: null, activityId: null, clientActivityId: null,
    features: [], extraUsers: 0, extraBranches: 0, extraModules: [], fingerprint: null, licenseKey: null, licenseIssuedAt: null,
    lastSeenAt: null, status: 'active', lastActivityAt: null, lastSupportAt: null, supportUnread: false, message: '', ...over,
  }
}

beforeEach(() => {
  for (const f of [...Object.values(b), ...Object.values(m)]) f.mockReset()
  b.status.mockResolvedValue(STATUS)
  b.lock.mockResolvedValue(undefined)
  m.audit.mockResolvedValue(undefined)
  useSessionStore.setState({ status: 'locked', profile: { name: 'محمد', phone: '', email: '' } })
})
afterEach(() => cleanup())

describe('شاشة القفل', () => {
  it('كلمة خاطئة ({ok:false}) لا تفتح اللوحة، وتُرسل الكلمة نفسها لا تجزئة', async () => {
    const user = userEvent.setup()
    b.verifyPassword.mockResolvedValue({ ok: false, code: 'wrong' })
    renderPage(<LockPage />)
    await user.type(input('كلمة مرور اللوحة'), 'خطأ-12345')
    await user.click(screen.getByRole('button', { name: 'دخول' }))
    await waitFor(() => expect(toasts()).toContain('كلمة المرور غير صحيحة'))
    expect(b.verifyPassword).toHaveBeenCalledWith('خطأ-12345')
    expect(useSessionStore.getState().status).toBe('locked')
  })

  it('الكلمة الصحيحة تفتح، وEnter يعمل مرة واحدة', async () => {
    const user = userEvent.setup()
    b.verifyPassword.mockResolvedValue({ ok: true })
    renderPage(<LockPage />)
    await user.type(input('كلمة مرور اللوحة'), 'صحيحة-12345{Enter}')
    await waitFor(() => expect(useSessionStore.getState().status).toBe('unlocked'))
    expect(b.verifyPassword).toHaveBeenCalledTimes(1)
  })

  it('التهدئة بعد محاولات كثيرة تُعرض بوضوح', async () => {
    const user = userEvent.setup()
    b.verifyPassword.mockResolvedValue({ ok: false, code: 'cooldown', retryInMs: 30000 })
    renderPage(<LockPage />)
    await user.type(input('كلمة مرور اللوحة'), 'x{Enter}')
    await waitFor(() => expect(toasts()).toMatch(/انتظر 30 ثانية/))
  })

  it('الاستعادة: كلمة ضعيفة/غير متطابقة لا تستدعي التحقق من الرمز (لا تهدر محاولة)، ثم الصحيحة تنجح', async () => {
    const user = userEvent.setup()
    b.requestOtp.mockResolvedValue({ ok: true, expiresAt: Date.now() + 300_000 })
    b.resetWithOtp.mockResolvedValue({ ok: true })
    renderPage(<LockPage />)
    await waitFor(() => expect((screen.getByRole('button', { name: 'نسيت كلمة المرور؟' }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'نسيت كلمة المرور؟' }))
    await user.click(screen.getByRole('button', { name: 'إرسال الرمز إلى تليجرام' }))
    await screen.findByText(/أُرسل الرمز/)
    expect(b.requestOtp).toHaveBeenCalledWith('استعادة كلمة المرور')

    await user.type(input('رمز التحقق (6 أرقام)'), '123456')
    await user.type(input('كلمة المرور الجديدة'), 'short')
    await user.type(input('تأكيد كلمة المرور الجديدة'), 'short')
    await user.click(screen.getByRole('button', { name: 'حفظ كلمة المرور الجديدة' }))
    await waitFor(() => expect(toasts()).toMatch(/قصيرة/))
    expect(b.resetWithOtp).not.toHaveBeenCalled()

    fireEvent.change(input('كلمة المرور الجديدة'), { target: { value: 'طويلة-وقوية-1' } })
    fireEvent.change(input('تأكيد كلمة المرور الجديدة'), { target: { value: 'مختلفة-تماماً-2' } })
    await user.click(screen.getByRole('button', { name: 'حفظ كلمة المرور الجديدة' }))
    await waitFor(() => expect(toasts()).toMatch(/غير متطابقتين/))
    expect(b.resetWithOtp).not.toHaveBeenCalled()

    fireEvent.change(input('تأكيد كلمة المرور الجديدة'), { target: { value: 'طويلة-وقوية-1' } })
    await user.click(screen.getByRole('button', { name: 'حفظ كلمة المرور الجديدة' }))
    await waitFor(() => expect(b.resetWithOtp).toHaveBeenCalledTimes(1))
    expect(b.resetWithOtp.mock.calls[0][0]).toBe('123456')
    expect(b.resetWithOtp.mock.calls[0][1]).toMatchObject({ salt: expect.any(String), hash: expect.any(String) })
    await waitFor(() => expect(toasts()).toMatch(/تم تحديث كلمة المرور/))
    expect(useSessionStore.getState().status).toBe('locked') // الاستعادة لا تفتح اللوحة بنفسها
  })

  it('رمز منتهٍ/محاولات منتهية ⇒ رجوع لشاشة الإرسال', async () => {
    const user = userEvent.setup()
    b.requestOtp.mockResolvedValue({ ok: true, expiresAt: Date.now() + 300_000 })
    b.resetWithOtp.mockResolvedValue({ ok: false, code: 'locked', error: 'محاولات كثيرة خاطئة — أعد الإرسال' })
    renderPage(<LockPage />)
    await waitFor(() => expect((screen.getByRole('button', { name: 'نسيت كلمة المرور؟' }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'نسيت كلمة المرور؟' }))
    await user.click(screen.getByRole('button', { name: 'إرسال الرمز إلى تليجرام' }))
    await screen.findByText(/أُرسل الرمز/)
    await user.type(input('رمز التحقق (6 أرقام)'), '000000')
    await user.type(input('كلمة المرور الجديدة'), 'طويلة-وقوية-1')
    await user.type(input('تأكيد كلمة المرور الجديدة'), 'طويلة-وقوية-1')
    await user.click(screen.getByRole('button', { name: 'حفظ كلمة المرور الجديدة' }))
    expect(await screen.findByRole('button', { name: 'إرسال الرمز إلى تليجرام' })).toBeTruthy()
    expect(toasts()).toMatch(/محاولات كثيرة/)
  })

  it('قفل اللوحة يقفل العملية الرئيسية أيضاً', () => {
    useSessionStore.setState({ status: 'unlocked' })
    useSessionStore.getState().lock()
    expect(b.lock).toHaveBeenCalledTimes(1)
    expect(useSessionStore.getState().status).toBe('locked')
  })
})

describe('الإعدادات — تغيير كلمة المرور (كان الزر يعرض تلميحاً فقط)', () => {
  it('الحالية خاطئة ⇒ لا حفظ؛ صحيحة ⇒ حفظ تجزئة الجديدة', async () => {
    const user = userEvent.setup()
    renderPage(<ChangePasswordForm />)
    b.verifyPassword.mockResolvedValueOnce({ ok: false, code: 'wrong' })
    await user.type(input('كلمة المرور الحالية'), 'قديمة-خاطئة')
    await user.type(input('كلمة المرور الجديدة'), 'جديدة-قوية-1')
    await user.type(input('تأكيد الجديدة'), 'جديدة-قوية-1')
    await user.click(screen.getByRole('button', { name: 'تغيير كلمة المرور' }))
    await waitFor(() => expect(toasts()).toMatch(/الحالية غير صحيحة/))
    expect(b.setPassword).not.toHaveBeenCalled()

    b.verifyPassword.mockResolvedValueOnce({ ok: true })
    b.setPassword.mockResolvedValueOnce(undefined)
    await user.click(screen.getByRole('button', { name: 'تغيير كلمة المرور' }))
    await waitFor(() => expect(b.setPassword).toHaveBeenCalledTimes(1))
    expect(b.setPassword.mock.calls[0][0]).toMatchObject({ salt: expect.any(String), hash: expect.any(String), iterations: expect.any(Number) })
    await waitFor(() => expect(toasts()).toMatch(/تم تغيير كلمة المرور/))
    expect(m.audit).toHaveBeenCalledWith('password_change', undefined, {})
  })

  it('رفض الحفظ من العملية الرئيسية يُعرض خطأً', async () => {
    const user = userEvent.setup()
    renderPage(<ChangePasswordForm />)
    b.verifyPassword.mockResolvedValueOnce({ ok: true })
    b.setPassword.mockRejectedValueOnce(new Error('اللوحة مقفلة'))
    await user.type(input('كلمة المرور الحالية'), 'قديمة-صحيحة')
    await user.type(input('كلمة المرور الجديدة'), 'جديدة-قوية-1')
    await user.type(input('تأكيد الجديدة'), 'جديدة-قوية-1')
    await user.click(screen.getByRole('button', { name: 'تغيير كلمة المرور' }))
    await waitFor(() => expect(toasts()).toMatch(/اللوحة مقفلة/))
  })
})

describe('سجل التدقيق', () => {
  it('التفاصيل النصية تُعرض كما هي (لا تهريب مزدوج)، وفشل التحميل يُعرض', async () => {
    expect(formatAuditDetails('{"plan":"pro"}')).toBe('{"plan":"pro"}')
    expect(formatAuditDetails({ plan: 'pro' })).toBe('{"plan":"pro"}')
    expect(formatAuditDetails(null)).toBe('—')
    b.auditList.mockResolvedValueOnce([{ id: 1, action: 'license_issue', target: 'D', details: '{"plan":"pro"}', at: undefined }])
    renderPage(<AuditPage />)
    expect(await screen.findByText('{"plan":"pro"}')).toBeTruthy()
    b.auditList.mockRejectedValueOnce(new Error('انقطاع'))
    await userEvent.setup().click(screen.getByRole('button', { name: 'تحديث' }))
    expect(await screen.findByText(/تعذر تحميل السجل: انقطاع/)).toBeTruthy()
  })

  it('رد القناة المقفلة ({ok:false}) يُعرض خطأً بدل الانهيار', async () => {
    b.auditList.mockResolvedValueOnce({ ok: false, code: 'locked', error: 'اللوحة مقفلة' })
    renderPage(<AuditPage />)
    expect(await screen.findByText(/اللوحة مقفلة/)).toBeTruthy()
  })
})

describe('صفحة الدعم', () => {
  const refresh = vi.fn(async () => {})
  beforeEach(() => refresh.mockClear())

  it('«جديد» من بيانات التحديث لكل العملاء (حتى رقم 80)، وأجهزة بلا تفعيل تظهر', () => {
    const customers = Array.from({ length: 80 }, (_, i) => cust({ deviceId: `C${i}`, customer: `عميل ${i}` }))
    customers[79] = cust({ deviceId: 'C79', customer: 'عميل 79', lastSupportAt: '2026-10-08T10:00:00Z', supportUnread: true })
    customers[5] = cust({ deviceId: 'C5', customer: 'عميل 5', lastSupportAt: '2026-10-07T10:00:00Z', supportUnread: false })
    useDataStore.setState({ customers, chatOnly: [{ deviceId: 'NEW-1', lastSupportAt: '2026-10-09T09:00:00Z', supportUnread: true }], refresh, servicesAvailable: true })
    renderPage(<SupportPage />)
    const items = screen.getAllByRole('button').filter((x) => x.className.includes('nav-item'))
    expect(items.map((x) => x.textContent)).toEqual([
      expect.stringContaining('NEW-1'),
      expect.stringContaining('عميل 79'),
      expect.stringContaining('عميل 5'),
    ])
    expect(items[0].textContent).toContain('لم يُفعَّل بعد')
    expect(items[0].textContent).toContain('جديد')
    expect(items[1].textContent).toContain('جديد')
    expect(items[2].textContent).not.toContain('جديد')
  })

  it('ردّ بطيء لتذكرة سابقة لا يظهر تحت التذكرة المختارة الآن، والرد يزيل «جديد»', async () => {
    const user = userEvent.setup()
    useDataStore.setState({
      customers: [
        cust({ deviceId: 'A', customer: 'أحمد', lastSupportAt: '2026-10-08T10:00:00Z', supportUnread: true }),
        cust({ deviceId: 'B', customer: 'بسمة', lastSupportAt: '2026-10-07T10:00:00Z', supportUnread: true }),
      ],
      chatOnly: [], refresh, servicesAvailable: true,
    })
    let releaseA: (v: unknown) => void = () => {}
    m.readSupportChat.mockImplementation((id: string) => id === 'A'
      ? new Promise((r) => { releaseA = r })
      : Promise.resolve([{ id: 1, from: 'client', text: 'رسالة بسمة', at: 5 }]))
    renderPage(<SupportPage />)
    await user.click(screen.getByText('أحمد'))
    await user.click(screen.getByText('بسمة'))
    expect(await screen.findByText('رسالة بسمة')).toBeTruthy()
    releaseA([{ id: 1, from: 'client', text: 'رسالة أحمد', at: '2026-10-08T10:00:00Z' }])
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByText('رسالة أحمد')).toBeNull()
    expect(screen.getByText('رسالة بسمة')).toBeTruthy()

    m.replySupport.mockResolvedValueOnce(undefined)
    m.readSupportChat.mockResolvedValue([{ id: 1, from: 'client', text: 'رسالة بسمة', at: '' }, { id: 2, from: 'developer', text: 'تم', at: '' }])
    await user.type(screen.getByPlaceholderText('اكتب ردك للعميل…'), 'تم')
    await user.click(screen.getByRole('button', { name: 'إرسال الرد' }))
    await waitFor(() => expect(m.replySupport).toHaveBeenCalledWith('B', 'تم'))
    await waitFor(() => {
      const items = screen.getAllByRole('button').filter((x) => x.className.includes('nav-item'))
      expect(items.find((x) => x.textContent?.includes('بسمة'))!.textContent).not.toContain('جديد')
      expect(items.find((x) => x.textContent?.includes('أحمد'))!.textContent).toContain('جديد')
    })
  })
})
