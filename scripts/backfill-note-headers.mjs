#!/usr/bin/env node
/**
 * 既に公開したnote記事に、あとから見出し画像を付ける。
 *
 * 見出し画像の設定が効いていなかった時期の記事が画像なしのまま残っているため、
 * 編集画面を開いて画像を追加し、公開し直す。
 * 使い方: node scripts/backfill-note-headers.mjs [件数]
 */
import { chromium } from 'playwright'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { makeHeaderImage } from './make-header-image.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SESSION = join(__dirname, '.note-session.json')
const CREATOR = 'fast_tiger8331'
const LIMIT = Number(process.argv[2] || 20)

// このnoteアカウントは別事業の記事も混在している。ワークシールドの記事だけを直す。
const OURS = /フリーランス|契約|業務委託|下請|報酬|発注書|秘密保持/

async function listNotes() {
  const all = []
  for (let page = 1; page <= 6; page++) {
    const res = await fetch(`https://note.com/api/v2/creators/${CREATOR}/contents?kind=note&page=${page}`)
    const d = (await res.json()).data
    all.push(...d.contents)
    if (d.isLastPage) break
  }
  return all
}

/** 公開APIで見出し画像の有無を確かめる */
async function hasEyecatch(key) {
  const res = await fetch(`https://note.com/api/v3/notes/${key}`)
  if (!res.ok) return null
  return Boolean((await res.json()).data?.eyecatch)
}

const notes = await listNotes()
const targets = []
for (const n of notes) {
  if (!OURS.test(n.name)) continue
  const has = await hasEyecatch(n.key)
  if (has === false) targets.push(n)
}
console.log(`ワークシールドの記事 ${notes.filter(n => OURS.test(n.name)).length}本中、見出し画像なし ${targets.length}本`)
if (!targets.length) process.exit(0)

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })
const ctx = await browser.newContext({
  storageState: SESSION,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 }, locale: 'ja-JP',
})

let done = 0, failed = 0
for (const n of targets.slice(0, LIMIT)) {
  const page = await ctx.newPage()
  try {
    console.log(`\n▶ ${n.name.slice(0, 44)}`)
    const img = await makeHeaderImage(n.name, { browser })

    await page.goto(`https://editor.note.com/notes/${n.key}/edit/`, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForTimeout(4500)

    const coverBtn = page.locator('button[data-id="ButtonIcon"]').first()
    if (await coverBtn.count() === 0) throw new Error('見出し画像ボタンが見つからない')
    await coverBtn.click({ force: true })
    await page.waitForTimeout(1200)

    const chooser = page.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null)
    await page.locator('button:has-text("画像をアップロード")').first().click()
    const fc = await chooser
    if (fc) await fc.setFiles(img)
    else await page.locator('input[type="file"]').first().setInputFiles(img)
    await page.waitForTimeout(3500)

    const cropSave = page.getByRole('button', { name: '保存', exact: true }).first()
    if (!(await cropSave.count()) || !(await cropSave.isVisible())) throw new Error('切り抜きの「保存」が見つからない')
    await cropSave.click()
    await page.waitForTimeout(2500)

    // 公開済みの記事なので、更新して公開し直す
    await page.locator('button:has-text("公開に進む")').first().click({ timeout: 15000 })
    await page.waitForURL(/\/publish\/?$/, { timeout: 30000 }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(3000)

    const submit = page.getByRole('button', { name: /^(投稿する|更新する)$/, exact: false }).first()
    await submit.click()
    await page.waitForTimeout(6000)

    const ok = await hasEyecatch(n.key)
    if (ok) { console.log('  ✅ 見出し画像を追加しました'); done++ }
    else { console.log('  ⚠️ 反映を確認できませんでした'); failed++ }
  } catch (e) {
    console.log('  ⚠️ 失敗:', e.message.slice(0, 80))
    failed++
  } finally {
    await page.close()
  }
}

await browser.close()
console.log(`\n完了 ${done}本 / 失敗 ${failed}本`)
