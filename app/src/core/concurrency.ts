/**
 * تنفيذ دالة غير متزامنة على قائمة بحد أقصى للطلبات المتزامنة — مع الحفاظ على ترتيب النتائج.
 * يحمي من إطلاق آلاف الطلبات لـ Cloudflare API دفعة واحدة (حدّه ~1200 طلب / 5 دقائق،
 * والطلبات المتزامنة الكثيرة تفشل أو تُرفض قبل ذلك).
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length })
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: width }, worker))
  return out
}
