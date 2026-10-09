/**
 * إصلاحات الفحص الخامس — منطق نقي + إعادة المحاولة في main.cjs (الكود الحقيقي مستخرجاً من الملف).
 */
import { describe, it, expect } from 'vitest'
import { computeStatus, expiringFirst, type CustomerView } from '../src/core/customers.ts'
import { daysBetween, EXTRA_MODULES } from '../src/core/license.ts'
import { appendNotice, noticeRecipients, type SentNotice } from '../src/core/notices.ts'
import { desktopCfFetch } from './helpers/desktopSigner.ts'

describe('computeStatus / daysBetween', () => {
  it('تاريخ انتهاء غير مفهوم لا يظهر «نشطاً» (كان NaN يفلت من كل المقارنات)', () => {
    expect(computeStatus({ plan: 'basic', expiresAt: 'غير-تاريخ', todayIso: '2026-10-09' })).toBe('expired')
    expect(computeStatus({ plan: 'basic', expiresAt: '', todayIso: '2026-10-09' })).toBe('expired')
  })
  it('يقبل ISO كاملاً كما يقبل التاريخ وحده', () => {
    expect(daysBetween('2026-10-09', '2026-10-12T23:59:00Z')).toBe(3)
    expect(daysBetween('2026-10-09T22:00:00Z', '2026-10-10')).toBe(1)
    expect(computeStatus({ plan: 'basic', expiresAt: '2026-10-12T10:00:00Z', todayIso: '2026-10-09' })).toBe('expiring')
    expect(computeStatus({ plan: 'basic', expiresAt: '2027-10-12', todayIso: '2026-10-09' })).toBe('active')
    expect(computeStatus({ plan: 'basic', expiresAt: null, todayIso: '2026-10-09' })).toBe('active')
  })
  it('تعليق عدد الأقسام يطابق القائمة', () => {
    expect(EXTRA_MODULES).toHaveLength(18)
  })
})

describe('appendNotice', () => {
  const now = new Date('2026-10-09T12:00:00Z')
  const n = (id: string, expiresAt: string | null) => ({ id, title: 't', body: 'b', createdAt: '2026-10-01T00:00:00Z', expiresAt })
  it('الإشعار الدائم (بلا انتهاء) يبقى؛ المنتهي والتالف يُنظَّفان؛ الحقول الإضافية تبقى', () => {
    const raw = JSON.stringify([n('perm', null), n('old', '2026-10-01T00:00:00Z'), n('bad', 'xx'), { ...n('live', '2026-12-01T00:00:00Z'), pinned: true }])
    const out = JSON.parse(appendNotice(raw, n('new', '2026-11-01T00:00:00Z'), now)) as { id: string; pinned?: boolean }[]
    expect(out.map((x) => x.id)).toEqual(['perm', 'live', 'new'])
    expect(out[1].pinned).toBe(true)
  })
})

describe('noticeRecipients بعد التعديل', () => {
  const sent = (editedAt?: string): SentNotice => ({
    notice: { id: 'n1', title: 't', body: 'b', createdAt: '2026-10-01T00:00:00Z', expiresAt: null, ...(editedAt ? { editedAt } : {}) },
    scope: 'devices', deviceIds: ['A', 'B'], listKeys: ['notices:A', 'notices:B'],
  })
  const customers = [
    { deviceId: 'A', customer: 'أ', lastSeenAt: '2026-10-03T00:00:00Z' },
    { deviceId: 'B', customer: 'ب', lastSeenAt: '2026-10-06T00:00:00Z' },
  ]
  it('«وصله» يُحسب من آخر تعديل: من اتصل قبل التعديل رأى النص القديم فقط', () => {
    expect(noticeRecipients(sent(), customers, new Map()).map((r) => r.state)).toEqual(['delivered', 'delivered'])
    expect(noticeRecipients(sent('2026-10-05T00:00:00Z'), customers, new Map()).map((r) => r.state)).toEqual(['pending', 'delivered'])
    // إيصال القراءة يبقى «قرأه»
    expect(noticeRecipients(sent('2026-10-05T00:00:00Z'), customers, new Map([['A', { n1: '2026-10-02T00:00:00Z' }]]))[0].state).toBe('read')
    // تاريخ تعديل تالف → نرجع لتاريخ الإرسال
    expect(noticeRecipients(sent('xx'), customers, new Map()).map((r) => r.state)).toEqual(['delivered', 'delivered'])
  })
})

describe('expiringFirst (اللوحة الرئيسية)', () => {
  const c = (id: string, status: CustomerView['status'], expiresAt: string | null) => ({ deviceId: id, status, expiresAt }) as CustomerView
  it('القريب من الانتهاء أولاً بالأقرب، ثم المنتهي بالأحدث، ولا غيرهما، مع الحد', () => {
    const list = [
      c('expired-old', 'expired', '2025-01-01'), c('soon-3', 'expiring', '2026-10-12'), c('active', 'active', '2027-01-01'),
      c('expired-new', 'expired', '2026-10-01'), c('soon-1', 'expiring', '2026-10-10'), c('revoked', 'revoked', '2026-10-10'),
    ]
    expect(expiringFirst(list, 8).map((x) => x.deviceId)).toEqual(['soon-1', 'soon-3', 'expired-new', 'expired-old'])
    expect(expiringFirst(list, 2).map((x) => x.deviceId)).toEqual(['soon-1', 'soon-3'])
  })
})

describe('cfFetch في main.cjs — إعادة المحاولة عند 429 / 5xx / انقطاع', () => {
  const { cfFetch, retries, baseMs } = desktopCfFetch()
  const res = (status: number, retryAfter?: string) => ({ status, headers: { get: (h: string) => (h === 'retry-after' ? retryAfter ?? null : null) } })
  function harness(seq: (ReturnType<typeof res> | Error)[]) {
    const calls: string[] = []
    const sleeps: number[] = []
    const fetch = async (u: string) => {
      calls.push(u)
      const next = seq.shift()!
      if (next instanceof Error) throw next
      return next
    }
    return { calls, sleeps, opts: { fetch, sleep: async (ms: number) => { sleeps.push(ms) } } }
  }

  it('429 ثم نجاح → يعيد المحاولة وينجح، بتأخير متصاعد', async () => {
    const t = harness([res(429), res(503), res(200)])
    expect((await cfFetch('u', {}, t.opts)).status).toBe(200)
    expect(t.calls).toHaveLength(3)
    expect(t.sleeps).toEqual([baseMs, baseMs * 2])
  })
  it('يحترم Retry-After (بسقف 3 ثوانٍ)', async () => {
    const t = harness([res(429, '1'), res(429, '60'), res(200)])
    await cfFetch('u', {}, t.opts)
    expect(t.sleeps).toEqual([1000, 3000])
  })
  it('بعد استنفاد المحاولات يعيد آخر رد كما هو (لتظهر رسالة الخطأ المعتادة)', async () => {
    const t = harness([res(500), res(500), res(500), res(200)])
    expect((await cfFetch('u', {}, t.opts)).status).toBe(500)
    expect(t.calls).toHaveLength(retries + 1)
  })
  it('انقطاع الشبكة يُعاد؛ واستمراره يُرمى', async () => {
    const ok = harness([new Error('ECONNRESET'), res(200)])
    expect((await cfFetch('u', {}, ok.opts)).status).toBe(200)
    const bad = harness([new Error('a'), new Error('b'), new Error('c')])
    await expect(cfFetch('u', {}, bad.opts)).rejects.toThrow('c')
    expect(bad.calls).toHaveLength(3)
  })
  it('404 و401 وغيرهما لا تُعاد', async () => {
    for (const s of [200, 401, 403, 404]) {
      const t = harness([res(s), res(200)])
      expect((await cfFetch('u', {}, t.opts)).status).toBe(s)
      expect(t.calls).toHaveLength(1)
    }
  })
})
