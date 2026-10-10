/**
 * metadata مفاتيح KV: الشكل مطابق لما يقرؤه البوت، وكتابة KV مع metadata تُرسل multipart.
 */
import { describe, it, expect, vi } from 'vitest'
import { deviceMetadata, chatMetadata, DEVICE_META_VERSION, CHAT_META_VERSION } from '../src/core/kvMetadata.ts'
import { createKvClient, kvMultipartBody } from '../src/core/kv.ts'

describe('فهرس dev: (مطابق لـ deviceMetadata في البوت)', () => {
  it('الحقول الأربعة + الإصدار', () => {
    expect(DEVICE_META_VERSION).toBe(1)
    expect(deviceMetadata({ expiresAt: '2027-01-01', customer: 'محل', plan: 'pro', email: 'a@b.co', message: 'x' })).toEqual({
      v: 1, expiresAt: '2027-01-01', customer: 'محل', plan: 'pro', email: 'a@b.co',
    })
  })
  it('سجل بلا انتهاء أو فارغ ⇒ قيم آمنة (لا تنهار المزامنة)', () => {
    expect(deviceMetadata({})).toEqual({ v: 1, expiresAt: null, customer: '', plan: '', email: '' })
    expect(deviceMetadata(null)).toEqual({ v: 1, expiresAt: null, customer: '', plan: '', email: '' })
  })
  it('الحدود: الاسم 120 والبريد 128 والخطة 20', () => {
    const m = deviceMetadata({ customer: 'ا'.repeat(500), email: 'b'.repeat(500), plan: 'p'.repeat(50) })
    expect(m.customer).toHaveLength(120)
    expect(m.email).toHaveLength(128)
    expect(m.plan).toHaveLength(20)
  })
})

describe('فهرس chat: (مطابق لـ chatMetadata في cloud worker)', () => {
  it('آخر رسالة + العدد، وتنظيف النص (بلا <> ولا مسافات طرفية، 120 حرفاً)', () => {
    expect(CHAT_META_VERSION).toBe(1)
    const chat = [
      { id: 1, from: 'client', text: 'أ', at: '2026-10-09T10:00:00Z' },
      { id: 2, from: 'developer', text: '  <b>رد</b> مهم  ', at: '2026-10-10T08:00:00Z' },
    ]
    // إزالة < و> تُبقي الوسم كنص («b» و«/b») كما يفعل البوت، ثم trim
    expect(chatMetadata(chat)).toEqual({ v: 1, count: 2, lastFrom: 'developer', lastAt: '2026-10-10T08:00:00Z', lastText: 'bرد/b مهم' })
  })
  it('محادثة فارغة', () => {
    expect(chatMetadata([])).toEqual({ v: 1, count: 0, lastFrom: '', lastAt: '', lastText: '' })
  })
})

describe('كتابة KV مع metadata', () => {
  const cfg = { accountId: 'a'.repeat(32), apiToken: 'tok', namespaces: { license: 'ns-lic', services: 'ns-svc' } }

  it('بدون metadata: جسم نصي كما كان', async () => {
    let init: RequestInit | undefined
    const f = (async (_u: string, i?: RequestInit) => { init = i; return new Response(JSON.stringify({ success: true, result: null }), { status: 200 }) }) as unknown as typeof fetch
    await createKvClient(cfg, f).put('license', 'dev:X', '{"a":1}')
    expect(init?.body).toBe('{"a":1}')
    expect((init?.headers as Record<string, string>)['content-type']).toBe('text/plain; charset=utf-8')
  })

  it('مع metadata: multipart فيه value و metadata، بلا content-type نصي (يضبطه المتصفح/المحرك مع الحدود)', async () => {
    let init: RequestInit | undefined
    const f = (async (_u: string, i?: RequestInit) => { init = i; return new Response(JSON.stringify({ success: true, result: null }), { status: 200 }) }) as unknown as typeof fetch
    await createKvClient(cfg, f).put('license', 'dev:X', '{"a":1}', { v: 1, customer: 'محل' })
    const body = init?.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('value')).toBe('{"a":1}')
    expect(JSON.parse(String(body.get('metadata')))).toEqual({ v: 1, customer: 'محل' })
    expect((init?.headers as Record<string, string>)['content-type']).toBeUndefined()
  })

  it('kvMultipartBody يبني الحقلين', () => {
    const form = kvMultipartBody('v', { k: 1 })
    expect(form.get('value')).toBe('v')
    expect(form.get('metadata')).toBe('{"k":1}')
  })
})
