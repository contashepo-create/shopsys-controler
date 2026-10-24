// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { GlobalDefaults } from '../../src/core/issueForm.ts'
import type { RegistrationRecord } from '../../src/core/registrations.ts'

const m = vi.hoisted(() => ({
  issueLicense: vi.fn(),
  lookupDevice: vi.fn(),
  readGlobalDefaults: vi.fn(),
  sendKeyToCustomer: vi.fn(),
  deactivateCustomer: vi.fn(),
  readCloudFlags: vi.fn(),
  setCloudFlag: vi.fn(),
}))
vi.mock('../../src/data/actions.ts', () => m)

const { RegistrationsPage } = await import('../../src/ui/pages/RegistrationsPage.tsx')
const { CustomersPage } = await import('../../src/ui/pages/CustomersPage.tsx')
const { ToastProvider } = await import('../../src/ui/components/ui.tsx')
const { useDataStore } = await import('../../src/stores/data.store.ts')

const DEFAULTS: GlobalDefaults = { plan: 'pro', days: 365, features: ['telegram_bot'], extraUsers: 0, extraBranches: 0, extraModules: [] }

function sampleReg(over: Partial<RegistrationRecord> = {}): RegistrationRecord {
  return {
    deviceId: 'SHOP-1111-2222-3333',
    shopName: 'صيدلية الأمل',
    ownerName: 'د. سارة',
    phone: '01012345678',
    email: 'sara@example.com',
    city: 'المنصورة',
    street: 'شارع الجمهورية',
    activityNameAr: 'صيدلية',
    countryCode: 'EG',
    platform: 'desktop',
    appVersion: '2.4.0',
    registeredAt: '2026-10-24T10:00:00Z',
    firstSeenAt: '2026-10-24T10:00:00Z',
    lastSeenAt: '2026-10-24T10:05:00Z',
    reports: 2,
    pendingChanges: { phone: '01222222222' },
    pendingAt: '2026-10-24T11:00:00Z',
    ...over,
  }
}

const refresh = vi.fn(async () => {})
const pollRegistrations = vi.fn(async () => {})
const markRegistrationsSeen = vi.fn()

beforeEach(() => {
  refresh.mockClear()
  pollRegistrations.mockClear()
  markRegistrationsSeen.mockClear()
  m.issueLicense.mockReset().mockResolvedValue({ key: 'SHOPSYS1.new.key', fingerprint: 'aaaa1111', payload: {}, notes: [] })
  m.lookupDevice.mockReset().mockResolvedValue(null)
  m.readGlobalDefaults.mockReset().mockResolvedValue(DEFAULTS)
  m.sendKeyToCustomer.mockReset().mockResolvedValue(undefined)
  const reg = sampleReg()
  useDataStore.setState({
    customers: [],
    registrations: [reg],
    pendingRegistrations: [reg],
    unreadNew: 1,
    lastNewIds: [reg.deviceId],
    lastSyncAt: new Date().toISOString(),
    loading: false,
    error: null,
    refresh,
    pollRegistrations,
    markRegistrationsSeen,
  })
})
afterEach(() => cleanup())

function mount(initialEntry = '/registrations') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ToastProvider><RegistrationsPage /></ToastProvider>
    </MemoryRouter>,
  )
}

describe('RegistrationsPage — سير العمل الكامل', () => {
  it('يعرض المنصة بالعربية والحقول المعلّقة بالعربية ويفتح رابط واتساب آمن https://', async () => {
    const user = userEvent.setup()
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    try {
      mount()
      // عند وجود lastSyncAt يستدعي الفحص الخفيف بدل refresh الشاملة
      expect(pollRegistrations).toHaveBeenCalledWith(30_000)
      expect(refresh).not.toHaveBeenCalled()

      expect(screen.getByText(/سطح المكتب/)).toBeTruthy()
      expect(screen.getByText(/الهاتف: 01222222222/)).toBeTruthy()

      await user.click(screen.getByRole('button', { name: /واتساب/ }))
      expect(openSpy).toHaveBeenCalledWith('https://wa.me/201012345678', '_blank', 'noopener,noreferrer')
    } finally {
      openSpy.mockRestore()
    }
  })

  it('إصدار المفتاح يُبقي النافذة مفتوحة لإرسال المفتاح للعميل، ولا يسرّب اسم النشاط العربي كمعرّف برمجي', async () => {
    const user = userEvent.setup()
    mount()

    await user.click(screen.getByRole('button', { name: /إصدار مفتاح/ }))
    const issueBtn = await screen.findByRole('button', { name: /تنشيط العميل|إصدار المفتاح/ })
    await waitFor(() => expect((issueBtn as HTMLButtonElement).disabled).toBe(false))
    await user.click(issueBtn)

    await waitFor(() => expect(m.issueLicense).toHaveBeenCalledTimes(1))
    const [input, opts] = m.issueLicense.mock.calls[0]
    // لم يكن لدى التسجيل activityId برمجي (فقط activityNameAr='صيدلية') → لا يجوز توقيع 'صيدلية'!
    expect(input.activityId).toBeUndefined()
    expect(input.customer).toBe('صيدلية الأمل')
    expect(opts).toEqual({ renew: false, burnFingerprint: null })

    // النافذة بقيت مفتوحة والمفتاح وزر الإرسال للعميل ظاهران!
    expect(await screen.findByText('SHOPSYS1.new.key')).toBeTruthy()
    const sendBtn = screen.getByRole('button', { name: /أرسل المفتاح للعميل/ })
    await user.click(sendBtn)
    await waitFor(() => expect(m.sendKeyToCustomer).toHaveBeenCalledTimes(1))

    // الإغلاق يتم عند الضغط على «تم»
    await user.click(screen.getByRole('button', { name: 'تم' }))
    expect(screen.queryByText('SHOPSYS1.new.key')).toBeNull()
  })

  it('يفتح نافذة إصدار المفتاح تلقائياً عند القدوم من لوحة التحكم بالمعامل ?issue=<deviceId>', async () => {
    mount('/registrations?issue=SHOP-1111-2222-3333')
    expect(await screen.findByText(/إصدار مفتاح — صيدلية الأمل/)).toBeTruthy()
  })

  it('CustomersPage يعرض العميل المسجّل بلا رخصة (status=none) دون باقة وهمية «تجريبي» ولا يطلب readCloudFlags عبثاً', async () => {
    const user = userEvent.setup()
    m.readCloudFlags.mockReset().mockResolvedValue({ disabled: {}, reason: {} })
    const reg = sampleReg()
    useDataStore.setState({
      customers: [{
        deviceId: reg.deviceId,
        customer: reg.shopName,
        email: reg.email,
        plan: '',
        expiresAt: null,
        activityId: null,
        clientActivityId: 'pharmacy',
        extraModules: [],
        extraBranches: 0,
        extraUsers: 0,
        features: [],
        fingerprint: '',
        licenseKey: null,
        lastSeenAt: reg.lastSeenAt,
        lastActivityAt: null,
        message: null,
        unreadFromCustomer: 0,
        totalMessages: 0,
        status: 'none',
        daysRemaining: null,
      }],
      registrations: [reg],
      pendingRegistrations: [reg],
      servicesAvailable: true,
    })

    render(
      <MemoryRouter>
        <ToastProvider><CustomersPage /></ToastProvider>
      </MemoryRouter>,
    )

    // النقر على اسم العميل لفتح بطاقة التفاصيل
    await user.click(screen.getByText('صيدلية الأمل'))
    expect(await screen.findByText(/📞 الهاتف \(من التسجيل\)/)).toBeTruthy()
    // لا يجوز أن يظهر «تجريبي» في بطاقة اشتراك عميل بلا باقة، ولا يُكرر البريد مرتين، ولا يُطلب readCloudFlags لميزات فارغة
    expect(screen.queryByText('تجريبي')).toBeNull()
    expect(screen.queryByText(/📧 البريد \(من التسجيل\)/)).toBeNull()
    expect(m.readCloudFlags).not.toHaveBeenCalled()
  })
})
