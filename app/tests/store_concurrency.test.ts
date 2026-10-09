/**
 * حد التزامن: mapLimit + تحديث بيانات العملاء (data.store) فوق KV وهمي بمئات العملاء.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { FakeBridge } from './helpers/fakeBridge.ts'

const h = vi.hoisted(() => ({ fake: null as unknown as FakeBridge }))
vi.mock('../src/data/bridge.ts', async () => {
  const { createFakeBridge } = await import('./helpers/fakeBridge.ts')
  h.fake = createFakeBridge()
  return { bridge: h.fake.bridge, isDesktop: () => true, requireDesktop: () => {} }
})

const { mapLimit } = await import('../src/core/concurrency.ts')
const { useDataStore, READ_CONCURRENCY } = await import('../src/stores/data.store.ts')

describe('mapLimit', () => {
  it('يحافظ على ترتيب النتائج ولا يتجاوز الحد أبداً', async () => {
    let inFlight = 0
    let max = 0
    const items = Array.from({ length: 100 }, (_, i) => i)
    const out = await mapLimit(items, 7, async (x) => {
      inFlight++; max = Math.max(max, inFlight)
      await new Promise((r) => setTimeout(r, (x * 7) % 5))
      inFlight--
      return x * 2
    })
    expect(out).toEqual(items.map((x) => x * 2))
    expect(max).toBe(7)
  })

  it('قائمة فارغة / حد غير صالح / خطأ يُمرَّر', async () => {
    expect(await mapLimit([], 5, async () => 1)).toEqual([])
    expect(await mapLimit([1, 2, 3], 0, async (x) => x)).toEqual([1, 2, 3])
    expect(await mapLimit([1, 2], Number.NaN, async (x) => x)).toEqual([1, 2])
    await expect(mapLimit([1, 2, 3], 2, async (x) => { if (x === 2) throw new Error('boom'); return x })).rejects.toThrow('boom')
  })
})

describe('data.store.refresh مع 300 عميل', () => {
  beforeEach(() => {
    h.fake.reset()
    useDataStore.setState({ customers: [], loading: false, error: null })
  })

  function seed(n: number) {
    for (let i = 0; i < n; i++) {
      const id = `SHOP-${String(i).padStart(4, '0')}-AAAA-BBBB`
      const fp = i.toString(16).padStart(8, '0')
      h.fake.seed('license', `dev:${id}`, { customer: `عميل ${i}`, fingerprint: fp, plan: 'basic', expiresAt: '2099-01-01' })
      h.fake.seed('license', `lic:${fp}`, { payload: { v: 1, deviceId: id, customer: `عميل ${i}`, plan: 'pro', features: [], issuedAt: '2026-01-01', expiresAt: '2099-01-01' }, key: `SHOPSYS1.x.${fp}`, issuedAt: '2026-01-01' })
      h.fake.seed('license', `log:${id}`, [{ at: '2026-10-0' + ((i % 9) + 1) + ' 10:00', text: 'x' }])
      h.fake.seed('license', `email:user${i}@x.com`, id)
    }
    h.fake.seed('license', 'revoked', ['00000003'])
  }

  it('يبني كل العملاء صحيحاً (كل بادئة في مكانها) والتزامن لا يتجاوز الحد', async () => {
    seed(300)
    h.fake.latencyMs = 1
    h.fake.pageSize = 120
    await useDataStore.getState().refresh()
    const { customers, error } = useDataStore.getState()
    expect(error).toBeNull()
    expect(customers).toHaveLength(300)
    const c7 = customers.find((c) => c.customer === 'عميل 7')!
    expect(c7).toMatchObject({ plan: 'pro', email: 'user7@x.com', lastActivityAt: '2026-10-08 10:00', licenseKey: 'SHOPSYS1.x.00000007', status: 'active' })
    expect(customers.find((c) => c.customer === 'عميل 3')!.status).toBe('revoked')
    // القوائم (listKeys) تعمل بالتوازي لكل بادئة؛ القراءات محدودة بـ READ_CONCURRENCY
    expect(h.fake.stats.maxInFlight).toBeLessThanOrEqual(READ_CONCURRENCY + 5)
  })

  it('غياب مساحة الخدمات لا يُسقط العملاء', async () => {
    seed(5)
    h.fake.missingNs.add('services')
    await useDataStore.getState().refresh()
    const s = useDataStore.getState()
    expect(s.customers).toHaveLength(5)
    expect(s.servicesAvailable).toBe(false)
  })
})
