#!/usr/bin/env node
/**
 * note.com 自動投稿スクリプト（Playwright改良版）
 *
 * 改善点:
 * - contenteditable要素にはpage.evaluate()でdispatchEventを使用
 * - 各ステップでスクリーンショットを保存（デバッグ用）
 * - ネットワークアイドル待機で確実にページ読み込みを待つ
 */

import { chromium } from 'playwright'
import { writeFileSync, mkdirSync, existsSync, readFileSync, createWriteStream } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import https from 'https'
import os from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENSHOT_DIR = join(__dirname, '..', 'debug-screenshots')
const SESSION_FILE = join(__dirname, '.note-session.json')

function saveScreenshot(page, name) {
  return page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`) }).catch(() => {})
}

// contenteditable要素に確実にテキストを入力
async function typeIntoContentEditable(page, selector, text) {
  const el = page.locator(selector).first()
  await el.waitFor({ timeout: 10000 })
  await el.click()
  await page.waitForTimeout(500)

  // まずクリアしてから入力
  await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (el) {
      el.focus()
      // 全選択してクリア
      document.execCommand('selectAll', false, null)
      document.execCommand('delete', false, null)
    }
  }, selector)

  // keyboard.typeはcontenteditable対応
  await page.keyboard.type(text, { delay: 20 })
  await page.waitForTimeout(300)

  // 入力確認
  const value = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    return el?.textContent ?? el?.innerText ?? ''
  }, selector)

  return value.length > 0
}

// Unsplashから画像URLを取得
async function fetchUnsplashImage(query) {
  const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY
  if (!UNSPLASH_KEY) return null
  try {
    const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape&client_id=${UNSPLASH_KEY}`
    const data = await new Promise((resolve, reject) => {
      https.get(url, res => {
        let body = ''
        res.on('data', d => body += d)
        res.on('end', () => resolve(JSON.parse(body)))
        res.on('error', reject)
      })
    })
    return data.urls?.regular ?? null
  } catch {
    return null
  }
}

// 画像URLをローカルに一時保存
async function downloadImage(imageUrl) {
  const tmpPath = join(os.tmpdir(), `note-img-${Date.now()}.jpg`)
  await new Promise((resolve, reject) => {
    const file = createWriteStream(tmpPath)
    https.get(imageUrl, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        https.get(res.headers.location, res2 => {
          res2.pipe(file)
          file.on('finish', () => file.close(resolve))
        }).on('error', reject)
      } else {
        res.pipe(file)
        file.on('finish', () => file.close(resolve))
      }
    }).on('error', reject)
  })
  return tmpPath
}

// note.comに画像をアップロードして本文に挿入
async function uploadImageToNote(page, imagePath) {
  try {
    const fileInput = await page.locator('input[type="file"]').first()
    // noteのツールバーから画像ボタンをクリック
    const imgBtn = page.locator('button[aria-label*="画像"], button[title*="画像"], .toolbar button:has(svg)').first()
    if (await imgBtn.count() > 0) {
      await imgBtn.click()
      await page.waitForTimeout(500)
    }
    const input = page.locator('input[type="file"][accept*="image"]').first()
    if (await input.count() > 0) {
      await input.setInputFiles(imagePath)
      await page.waitForTimeout(3000)
      return true
    }
  } catch {}
  return false
}

export async function postToNote(title, markdownBody) {
  if (!existsSync(SESSION_FILE)) {
    throw new Error('セッションファイルが見つかりません。node scripts/note-setup-session.mjs を実行してください。')
  }

  // Markdownをプレーンテキストに変換
  const body = markdownBody
    .replace(/^#{1,2}\s+(.+)$/gm, '\n$1\n')
    .replace(/^#{3,6}\s+(.+)$/gm, '\n■ $1\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^>\s*\*\*\[.*?\].*$/gm, '')  // CTAリンク行を除去
    .replace(/^>\s*/gm, '')
    .replace(/`(.+?)`/g, '$1')
    .replace(/```[\s\S]+?```/gm, '')
    .replace(/^[-*]\s+/gm, '・')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 40000)

  try { mkdirSync(SCREENSHOT_DIR, { recursive: true }) } catch {}

  const sessionState = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'))

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'ja-JP',
    storageState: sessionState,
  })
  const page = await context.newPage()

  try {
    // ── ① セッション確認 ────────────────────────────────────────
    console.log('🔐 セッション確認中...')
    await page.goto('https://note.com', { waitUntil: 'networkidle', timeout: 30000 })
    await saveScreenshot(page, '01-session-check')

    if (page.url().includes('/login')) {
      throw new Error('セッション期限切れ。node scripts/note-setup-session.mjs を再実行してください。')
    }
    console.log('✅ ログイン済み確認')

    // ── ② Unsplash画像取得 ───────────────────────────────────
    console.log('🖼️ Unsplash画像取得中...')
    const keywords = title.replace(/[【】「」]/g, ' ').split(/\s+/).slice(0, 3).join(' ')
    const headerImageUrl = await fetchUnsplashImage(keywords)
    const bodyImageUrl = await fetchUnsplashImage(keywords + ' business')
    let headerImagePath = null
    let bodyImagePath = null
    if (headerImageUrl) headerImagePath = await downloadImage(headerImageUrl)
    if (bodyImageUrl) bodyImagePath = await downloadImage(bodyImageUrl)
    console.log(headerImagePath ? '✅ 見出し画像取得成功' : '⚠️ 見出し画像取得失敗')

    // ── ③ 新規記事ページへ ────────────────────────────────────
    console.log('✍️ 新規記事ページへ移動...')
    await page.goto('https://note.com/notes/new', { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(3000)
    await saveScreenshot(page, '04-new-article-page')

    // ── ③ タイトル入力 ────────────────────────────────────────
    console.log('📝 タイトル入力...')

    // タイトル要素を探す（優先順位順）
    const titleSelectors = [
      'textarea[placeholder="タイトル"]',
      'input[placeholder="タイトル"]',
      '[data-placeholder="タイトル"]',
      'h1[contenteditable]',
      '[placeholder*="タイトル"]',
      'div[contenteditable="true"]:first-of-type',
    ]

    let titleDone = false
    for (const sel of titleSelectors) {
      try {
        const count = await page.locator(sel).count()
        if (count === 0) continue

        const el = page.locator(sel).first()
        const tagName = await el.evaluate(e => e.tagName.toLowerCase())

        if (tagName === 'textarea' || tagName === 'input') {
          await el.fill(title)
        } else {
          // contenteditable
          await el.click()
          await page.waitForTimeout(300)
          await page.evaluate((sel, t) => {
            const el = document.querySelector(sel)
            if (!el) return
            el.focus()
            document.execCommand('selectAll', false, null)
            document.execCommand('insertText', false, t)
          }, sel, title)
        }

        const val = await el.evaluate(e => e.value ?? e.textContent ?? e.innerText)
        if (val?.trim()) {
          console.log(`✅ タイトル入力成功: ${sel}`)
          titleDone = true
          break
        }
      } catch (e) {
        // 次のセレクターへ
      }
    }

    if (!titleDone) {
      // 最終手段: Tabキーで移動しながら入力
      await page.keyboard.press('Tab')
      await page.keyboard.type(title, { delay: 30 })
      console.log('⚠️ タイトル: フォールバック入力を試みました')
    }

    await saveScreenshot(page, '05-title-entered')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(500)

    // ── ④ 本文入力 ────────────────────────────────────────────
    console.log('📄 本文入力...')
    const bodySelectors = [
      '.ProseMirror',
      '[data-placeholder="本文を書く"]',
      '[placeholder="本文を書く"]',
      'div.editor',
      'div[contenteditable="true"]:last-of-type',
      'div[contenteditable="true"]:nth-of-type(2)',
    ]

    let bodyDone = false
    for (const sel of bodySelectors) {
      try {
        const count = await page.locator(sel).count()
        if (count === 0) continue

        const el = page.locator(sel).first()
        await el.click()
        await page.waitForTimeout(300)

        // 本文は長いのでchunkに分けて入力
        const chunks = body.match(/.{1,500}/gs) ?? [body]
        for (const chunk of chunks) {
          await page.evaluate((sel, text) => {
            const el = document.querySelector(sel)
            if (!el) return
            el.focus()
            document.execCommand('insertText', false, text)
          }, sel, chunk)
          await page.waitForTimeout(100)
        }

        const val = await el.evaluate(e => e.textContent ?? e.innerText ?? '')
        if (val?.trim().length > 10) {
          console.log(`✅ 本文入力成功: ${sel}`)
          bodyDone = true
          break
        }
      } catch {}
    }

    if (!bodyDone) {
      await page.keyboard.type(body.slice(0, 3000), { delay: 5 })
      console.log('⚠️ 本文: フォールバック入力を試みました')
    }

    await saveScreenshot(page, '06-body-entered')

    // ── ⑤ 見出し画像設定 ─────────────────────────────────────
    if (headerImagePath) {
      console.log('🖼️ 見出し画像をアップロード中...')
      try {
        // note.comの見出し画像ボタン
        const coverBtn = page.locator('button:has-text("見出し画像"), label:has-text("見出し画像"), [class*="cover"], [class*="eyecatch"]').first()
        if (await coverBtn.count() > 0) {
          await coverBtn.click()
          await page.waitForTimeout(1000)
          const fileInput = page.locator('input[type="file"]').first()
          if (await fileInput.count() > 0) {
            await fileInput.setInputFiles(headerImagePath)
            await page.waitForTimeout(3000)
            console.log('✅ 見出し画像アップロード完了')
          }
        }
      } catch (e) {
        console.log('⚠️ 見出し画像アップロード失敗:', e.message)
      }
      await saveScreenshot(page, '06b-header-image')
    }

    // ── ⑥ 本文中に画像挿入 ──────────────────────────────────
    if (bodyImagePath) {
      console.log('🖼️ 本文中に画像を挿入中...')
      try {
        // 本文エリアの中央にカーソルを移動して画像挿入
        const editor = page.locator('.ProseMirror, [data-placeholder="本文を書く"]').first()
        if (await editor.count() > 0) {
          await editor.click()
          // 本文の中頃に移動（Ctrl+End後に少し戻る）
          await page.keyboard.press('Control+End')
          await page.waitForTimeout(300)
          await page.keyboard.press('Enter')
          // 画像アップロードボタンを探してクリック
          const imgUploadBtn = page.locator('button[aria-label*="画像"], input[type="file"][accept*="image"]').first()
          if (await imgUploadBtn.count() > 0) {
            if ((await imgUploadBtn.evaluate(e => e.tagName)) === 'INPUT') {
              await imgUploadBtn.setInputFiles(bodyImagePath)
            } else {
              await imgUploadBtn.click()
              await page.waitForTimeout(500)
              const fileInput = page.locator('input[type="file"]').first()
              if (await fileInput.count() > 0) {
                await fileInput.setInputFiles(bodyImagePath)
              }
            }
            await page.waitForTimeout(3000)
            console.log('✅ 本文中画像挿入完了')
          }
        }
      } catch (e) {
        console.log('⚠️ 本文画像挿入失敗:', e.message)
      }
      await saveScreenshot(page, '06c-body-image')
    }

    // ── ⑦ 公開 ───────────────────────────────────────────────
    console.log('🚀 公開中...')
    await page.waitForTimeout(1000)

    const publishBtn = page.locator('button:has-text("公開"), button:has-text("投稿"), button:has-text("公開する")').first()
    await publishBtn.click({ timeout: 10000 })
    await page.waitForTimeout(2000)
    await saveScreenshot(page, '07-publish-dialog')

    // 確認ダイアログが出た場合
    const confirmBtn = page.locator('button:has-text("公開する"), button:has-text("投稿する"), button:has-text("OK")').first()
    const confirmCount = await confirmBtn.count()
    if (confirmCount > 0) {
      await confirmBtn.click()
      await page.waitForTimeout(3000)
    }

    await saveScreenshot(page, '08-published')

    const finalUrl = page.url()
    console.log(`✅ 投稿完了: ${finalUrl}`)
    return finalUrl

  } finally {
    await browser.close()
  }
}

// ── 単体テスト実行 ──────────────────────────────────────────────
if (process.argv[1].endsWith('post-to-note.mjs')) {
  const title = process.env.NOTE_TEST_TITLE ?? 'テスト投稿：フリーランス新法の基本'
  const body = process.env.NOTE_TEST_BODY ?? `# フリーランス新法とは

2024年11月に施行されたフリーランスを守るための法律です。

## 主なポイント

・支払期日は60日以内と定められています（第4条）
・無償修正の強要は禁止です（第5条）
・即日解除は違法です（第16条）

詳しくはこちらで確認できます。`

  postToNote(title, body)
    .then(url => console.log(`\n🎉 完了: ${url}`))
    .catch(err => {
      console.error('❌ エラー:', err.message)
      process.exit(1)
    })
}
