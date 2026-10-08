/**
 * حراس المعمارية: تفصل هذه الاختبارات بين ما يجوز تغييره وما لا يجوز.
 *
 * 1) قناة التحديث = الرف العام `shopsys-controler-updater` (بلا كود). أي إرجاع لها إلى
 *    المستودع الخاص يكسر التحديث عند المالك (توكن مدفون) ⇒ يفشل الاختبار هنا.
 * 2) بيانات المالك: ثوابت الهوية (appId / name) التي يُشتق منها مجلد البيانات — تغييرها
 *    يعني ضياع المفاتيح وكلمة المرور. وكذلك منع الحذف عند الإزالة.
 * 3) سلوك المالك المطلوب: تنزيل في الخلفية + تثبيت عند الإغلاق.
 * 4) الإصدار الآلي: أي كود يصل main يوسم تلقائياً، والنشر يحتاج سر الرف العام.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')
const repoRoot = join(appRoot, '..')

const builderYml = readFileSync(join(appRoot, 'electron-builder.yml'), 'utf8')
const mainCjs = readFileSync(join(appRoot, 'desktop', 'main.cjs'), 'utf8')
const preloadCjs = readFileSync(join(appRoot, 'desktop', 'preload.cjs'), 'utf8')
const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
const autoRelease = readFileSync(join(repoRoot, '.github', 'workflows', 'auto-release.yml'), 'utf8')
const releaseWin = readFileSync(join(repoRoot, '.github', 'workflows', 'release-windows.yml'), 'utf8')

describe('قناة التحديث — رف عام بلا كود', () => {
  it('electron-builder ينشر إلى shopsys-controler-updater وليس إلى المستودع الخاص', () => {
    expect(builderYml).toMatch(/repo:\s*shopsys-controler-updater/)
    expect(builderYml).not.toMatch(/repo:\s*shopsys-controler\s*$/m)
  })

  it('سير النشر يرفع إلى الرف العام خلال سر مخصص، ويفشل بوضوح إن غاب', () => {
    expect(releaseWin).toMatch(/secrets\.RELEASES_REPO_TOKEN/)
    expect(releaseWin).toMatch(/contashepo-create\/shopsys-controler-updater/)
    expect(releaseWin).toMatch(/latest\.yml/)
  })

  it('الحزمة تحمل ملفات التحديث المطلوبة في النشر (لا نشر بلا فهرس تحديث)', () => {
    expect(releaseWin).toMatch(/app\/release\/latest\.yml/)
    expect(releaseWin).toMatch(/blockmap/)
    // الوجهة داخل الحزمة تُفحص قبل النشر
    expect(releaseWin).toMatch(/app-update\.yml/)
  })
})

describe('بيانات المالك — لا تضيع مع التحديث', () => {
  it('هوية التطبيق ثابتة (منها يُشتق مجلد البيانات %APPDATA%)', () => {
    expect(builderYml).toMatch(/appId:\s*com\.contashepo\.shopsys-controler/)
    expect(pkg.name).toBe('shopsys-controler')
  })

  it('لا حذف لبيانات المالك عند الإزالة أو التحديث', () => {
    expect(builderYml).toMatch(/deleteAppDataOnUninstall:\s*false/)
  })

  it('لقطة احتياطية تلقائية تُؤخذ عند الإقلاع إلى مجلد بياناته', () => {
    expect(mainCjs).toMatch(/function snapshotData/)
    expect(mainCjs).toMatch(/config-backups/)
    expect(mainCjs).toMatch(/snapshotData\(\)\s*\/\/|snapshotData\(\)/)
    // القناة متاحة للواجهة عبر العزل وبلا كشف أي سر
    expect(preloadCjs).toMatch(/'app:snapshotData'/)
    expect(preloadCjs).toMatch(/'app:dataInfo'/)
  })

  it('اللقطة تحفظ الملفات الحسّاسة كملفات مشفَّرة كما هي (لا فك تشفير ولا طباعة)', () => {
    const block = mainCjs.slice(mainCjs.indexOf('function snapshotData'), mainCjs.indexOf('function dataInfo'))
    expect(block).toMatch(/copyFileSync/)
    expect(block).not.toMatch(/decryptSecret/)
    expect(block).not.toMatch(/console\.log/)
  })
})

describe('سلوك التحديث عند المالك (طلبه الصريح)', () => {
  it('التنزيل في الخلفية والتثبيت عند الإغلاق', () => {
    expect(mainCjs).toMatch(/autoUpdater\.autoDownload\s*=\s*true/)
    expect(mainCjs).toMatch(/autoUpdater\.autoInstallOnAppQuit\s*=\s*true/)
  })

  it('لا رجوع لإصدار أقدم ولا إصدارات تجريبية', () => {
    expect(mainCjs).toMatch(/allowDowngrade\s*=\s*false/)
    expect(mainCjs).toMatch(/allowPrerelease\s*=\s*false/)
  })

  it('الفحص بعد الإقلاع ثم كل 6 ساعات', () => {
    expect(mainCjs).toMatch(/12_000|12_000/)
    expect(mainCjs).toMatch(/6 \* 60 \* 60 \* 1000/)
  })

  it('قنوات التحديث الأربع مصروحة في العزل', () => {
    for (const ch of ['update:state', 'update:check', 'update:download', 'update:install']) {
      expect(preloadCjs).toContain(`'${ch}'`)
    }
  })
})

describe('الإصدار الآلي', () => {
  it('يُشغَّل عند أي دفع لـ main ويحسب النسخة من أوسمة الخادم', () => {
    expect(autoRelease).toMatch(/branches:\s*\[main\]/)
    expect(autoRelease).toMatch(/ls-remote --tags/)
    expect(autoRelease).toMatch(/patch|PA \+ 1/)
  })

  it('يحمي نفسه من الدوران (لا إصدار لالتزام إصدار آلي)', () => {
    expect(autoRelease).toMatch(/chore\(release\)/)
  })

  it('تغييرات الوثائق وحدها لا تولّد إصدارات', () => {
    expect(autoRelease).toMatch(/paths-ignore/)
    expect(autoRelease).toMatch(/'docs\/\*\*'/)
  })

  it('يشغّل سير البناء صراحةً (وسم البوت لا يُشغّل سيراً بحسب قواعد GitHub)', () => {
    expect(autoRelease).toMatch(/gh workflow run release-windows\.yml/)
    expect(autoRelease).toMatch(/actions: write/)
    expect(releaseWin).toMatch(/workflow_dispatch/)
  })

  it('النشر مربوط بوسم إصدار فقط (لا نشر من فرع)', () => {
    expect(releaseWin).toMatch(/tags:\s*\n\s*-\s*'v\*'/)
    expect(releaseWin).toMatch(/\^v\[0-9\]\+/)
  })
})
