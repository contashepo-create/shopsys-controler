/**
 * درجات الإلزام للإشعارات (مطابقة للبوت — tools/devbot/src/adminPanel.js):
 * info ⇒ بلا إقرار · important/critical ⇒ إقرار إلزامي · تقليم لكل درجة على حدة.
 */
import { describe, it, expect } from 'vitest'
import { buildNotice, appendNotice, parseNoticeList, parseNoticeAcks, capNotices, NOTICE_KEEP_INFO, NOTICE_KEEP_URGENT, type CloudNotice } from '../src/core/notices.ts'

const NOW = new Date('2026-10-10T08:00:00Z')

describe('درجات الإشعار', () => {
  it('الافتراضي info بلا إقرار (توافق مع الإشعارات القديمة)', () => {
    const n = buildNotice({ body: 'نص' }, NOW)
    expect(n.level).toBe('info')
    expect(n.requiresAck).toBe(false)
    expect(n.title).toBe('رسالة من المطوّر')
  })

  it('مهم/عاجل يُكتبان بالدرجة وبإقرار إلزامي وعنوان افتراضي للدرجة', () => {
    const imp = buildNotice({ body: 'نص', level: 'important' }, NOW)
    expect(imp).toMatchObject({ level: 'important', requiresAck: true, title: 'تنبيه مهم من المطوّر' })
    const crit = buildNotice({ body: 'نص', level: 'critical' }, NOW)
    expect(crit).toMatchObject({ level: 'critical', requiresAck: true, title: 'تنبيه عاجل من المطوّر' })
  })

  it('درجة غير معروفة تُعامل كـ info', () => {
    expect(buildNotice({ body: 'نص', level: 'urgent-ish' }, NOW).level).toBe('info')
  })

  it('التنبيه العاجل يبقى بعد تراكم إعلانات أحدث منه (لا يُسقطه slice)', () => {
    let raw: string | null = appendNotice(null, buildNotice({ body: 'عاجل', level: 'critical', title: 'عاجل' }, NOW), NOW)
    for (let i = 0; i < 60; i++) {
      raw = appendNotice(raw, { ...buildNotice({ body: `إعلان ${i}` }, NOW), id: `info-${i}`, createdAt: new Date(NOW.getTime() + (i + 1) * 1000).toISOString() }, NOW)
    }
    const list = parseNoticeList(raw)
    expect(list.some((n) => n.level === 'critical')).toBe(true)
    expect(list.filter((n) => n.level !== 'critical')).toHaveLength(NOTICE_KEEP_INFO)
  })

  it('سقف المهم/العاجل منفصل عن الإعلانات', () => {
    const many: CloudNotice[] = Array.from({ length: NOTICE_KEEP_URGENT + 5 }, (_, i) => ({
      ...buildNotice({ body: `م${i}`, level: 'important' }, NOW), id: `u${i}`, createdAt: new Date(NOW.getTime() + i * 1000).toISOString(),
    }))
    const kept = capNotices(many)
    expect(kept).toHaveLength(NOTICE_KEEP_URGENT)
    expect(kept[0].id).toBe('u5') // الأقدم يُسقط
  })
})

describe('إقرارات القراءة notice-acks', () => {
  it('قائمة أجهزة نصية فقط', () => {
    expect(parseNoticeAcks(JSON.stringify(['SHOP-AAAA-BBBB-CCCC', 5, null]))).toEqual(['SHOP-AAAA-BBBB-CCCC'])
    expect(parseNoticeAcks('{bad')).toEqual([])
    expect(parseNoticeAcks(null)).toEqual([])
  })
})
