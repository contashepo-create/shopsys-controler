/**
 * كتابة KV من الجسر المكتبي (main.cjs → cfPutInit): metadata لا تُكتب إلا بـmultipart.
 * الكود الحقيقي مستخرجاً من الملف — لا نسخة.
 */
import { describe, it, expect } from 'vitest'
import { desktopCfPutInit } from './helpers/desktopSigner.ts'

const cfPutInit = desktopCfPutInit()
const headers = { authorization: 'Bearer T', 'content-type': 'application/json; charset=utf-8' }

describe('cfPutInit — كتابة KV من الجسر المكتبي', () => {
  it('مع metadata: multipart فيه value وmetadata، والتوكن فقط (بلا content-type نصي يفسد الحدود)', () => {
    const init = cfPutInit('{"plan":"pro"}', { v: 1, plan: 'pro', expiresAt: null }, headers)
    expect(init.method).toBe('PUT')
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect(form.get('value')).toBe('{"plan":"pro"}')
    expect(JSON.parse(String(form.get('metadata')))).toEqual({ v: 1, plan: 'pro', expiresAt: null })
    expect(init.headers).toEqual({ authorization: 'Bearer T' })
  })

  it('بلا metadata: نص عادي بـtext/plain (الكتابة النصية كما كانت)', () => {
    const init = cfPutInit('revoked-list', undefined, headers)
    expect(init.body).toBe('revoked-list')
    expect(init.headers).toEqual({ authorization: 'Bearer T', 'content-type': 'text/plain; charset=utf-8' })
  })

  it('قيمة فارغة/غائبة لا تنهار (String(undefined) ممنوع)', () => {
    expect(cfPutInit(undefined as unknown as string, null, headers).body).toBe('')
    const withMeta = cfPutInit(undefined as unknown as string, { v: 1 }, headers).body as FormData
    expect(withMeta.get('value')).toBe('')
  })
})
