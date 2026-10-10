/**
 * مستند «حول» المشترك مع بوت المطوّر (shopsys: tools/devbot/src/aboutContent.js).
 * القاعدة: أي حقل لا تعرفه اللوحة يبقى كما هو عند الحفظ — لا يُحذف أبداً.
 */

export interface AboutDoc {
  title: string
  body: string
  supportPhone: string
  supportTelegram: string
  website: string
  supportWhatsapp: string
  supportEmail: string
  address: string
  workHours: string
  socialLinks: unknown[]
  extraFields: unknown[]
  updatedAt: string
  [field: string]: unknown
}

export const ABOUT_DEFAULT_TITLE = 'TAHAKAM ERP — تَحَكَّم في إدارة أعمالك'

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** يحلّل المستند المخزّن. نص خام قديم يصبح النص التعريفي. */
export function parseAboutDoc(raw: string | null | undefined): AboutDoc {
  const base: AboutDoc = {
    title: '', body: '', supportPhone: '', supportTelegram: '', website: '',
    supportWhatsapp: '', supportEmail: '', address: '', workHours: '',
    socialLinks: [], extraFields: [], updatedAt: '',
  }
  if (!raw) return base
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const o = parsed as Record<string, unknown>
      return {
        ...o,
        title: str(o.title), body: str(o.body),
        supportPhone: str(o.supportPhone), supportTelegram: str(o.supportTelegram), website: str(o.website),
        supportWhatsapp: str(o.supportWhatsapp), supportEmail: str(o.supportEmail),
        address: str(o.address), workHours: str(o.workHours),
        socialLinks: Array.isArray(o.socialLinks) ? o.socialLinks : [],
        extraFields: Array.isArray(o.extraFields) ? o.extraFields : [],
        updatedAt: str(o.updatedAt),
      }
    }
  } catch { /* نص خام */ }
  return { ...base, body: raw }
}
