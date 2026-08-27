#!/usr/bin/env node
/**
 * note.com 自動投稿スクリプト（editor.note.com 新UI対応版・2026-08更新）
 *
 * note.comのエディタが新UI（editor.note.com）に刷新されたことに伴い、
 * セレクタを全面的に更新。実際のDOMを調査した上で以下を確定：
 * - タイトル欄:   textarea[placeholder="記事タイトル"]
 * - 本文欄:       .ProseMirror
 * - 見出し画像:   タイトル上の button[data-id="ButtonIcon"] → 「画像をアップロード」
 * - 本文中画像:   行頭の aria-label="メニューを開く" ボタン → 「画像」
 * - 公開ボタン:   button:has-text("公開に進む") → ダイアログ内 button:has-text("投稿する")
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
    viewport: { width: 1280, height: 900 },
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

    // ── ③ 新規記事ページへ（editor.note.com にリダイレクトされる）──
    console.log('✍️ 新規記事ページへ移動...')
    await page.goto('https://note.com/notes/new', { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(3000)
    await saveScreenshot(page, '04-new-article-page')

    // ── ④ タイトル入力 ────────────────────────────────────────
    console.log('📝 タイトル入力...')
    let titleDone = false
    try {
      const titleEl = page.locator('textarea[placeholder="記事タイトル"]').first()
      await titleEl.waitFor({ timeout: 10000 })
      await titleEl.click()
      await page.keyboard.type(title, { delay: 15 })
      const val = await titleEl.inputValue().catch(() => '')
      if (val?.trim()) {
        console.log('✅ タイトル入力成功')
        titleDone = true
      }
    } catch (e) {
      console.log('⚠️ タイトル欄が見つからず:', e.message)
    }

    if (!titleDone) {
      await page.keyboard.press('Tab')
      await page.keyboard.type(title, { delay: 30 })
      console.log('⚠️ タイトル: フォールバック入力を試みました')
    }

    await saveScreenshot(page, '05-title-entered')

    // ── ⑤ 本文入力 ────────────────────────────────────────────
    console.log('📄 本文入力...')
    let bodyDone = false
    try {
      const bodyEl = page.locator('.ProseMirror').first()
      await bodyEl.waitFor({ timeout: 10000 })
      await bodyEl.click()
      await page.waitForTimeout(300)

      // 本文は長いのでchunkに分けて入力（型入力でエディタのイベントを正しく発火させる）
      const chunks = body.match(/.{1,800}/gs) ?? [body]
      for (const chunk of chunks) {
        await page.keyboard.type(chunk, { delay: 1 })
      }

      const val = await bodyEl.evaluate(e => e.textContent ?? e.innerText ?? '')
      if (val?.trim().length > 10) {
        console.log('✅ 本文入力成功')
        bodyDone = true
      }
    } catch (e) {
      console.log('⚠️ 本文入力エラー:', e.message)
    }

    if (!bodyDone) {
      await page.keyboard.type(body.slice(0, 3000), { delay: 5 })
      console.log('⚠️ 本文: フォールバック入力を試みました')
    }

    await saveScreenshot(page, '06-body-entered')

    // ── ⑥ 見出し画像設定 ─────────────────────────────────────
    // タイトル欄の直上にある画像追加ボタン（data-id="ButtonIcon"）→「画像をアップロード」
    if (headerImagePath) {
      console.log('🖼️ 見出し画像をアップロード中...')
      try {
        const coverBtn = page.locator('button[data-id="ButtonIcon"]').first()
        if (await coverBtn.count() > 0) {
          await coverBtn.click()
          await page.waitForTimeout(800)
          const uploadOption = page.locator('button:has-text("画像をアップロード")').first()
          if (await uploadOption.count() > 0) {
            await uploadOption.click()
            await page.waitForTimeout(500)
          }
          const fileInput = page.locator('input[type="file"]').first()
          if (await fileInput.count() > 0) {
            await fileInput.setInputFiles(headerImagePath)
            await page.waitForTimeout(2500)
            // 見出し画像アップロード後に出るクロップ（切り抜き）確認モーダルを保存で閉じる
            const cropSaveBtn = page.locator('button:has-text("保存")').first()
            if (await cropSaveBtn.count() > 0 && await cropSaveBtn.isVisible()) {
              await cropSaveBtn.click({ force: true })
              await page.waitForTimeout(1500)
            }
            console.log('✅ 見出し画像アップロード完了')
          } else {
            console.log('⚠️ 見出し画像: file inputが見つからず')
          }
        } else {
          console.log('⚠️ 見出し画像ボタンが見つからず')
        }
      } catch (e) {
        console.log('⚠️ 見出し画像アップロード失敗:', e.message)
      }
      await saveScreenshot(page, '06b-header-image')
    }

    // ── ⑦ 本文中に画像挿入 ──────────────────────────────────
    // 本文末尾の行頭にある aria-label="メニューを開く" ボタン →「画像」
    if (bodyImagePath) {
      console.log('🖼️ 本文中に画像を挿入中...')
      try {
        const editor = page.locator('.ProseMirror').first()
        await editor.click()
        await page.keyboard.press('Control+End')
        await page.waitForTimeout(300)
        await page.keyboard.press('Enter')
        await page.waitForTimeout(500)

        const menuBtn = page.locator('button[aria-label="メニューを開く"]').first()
        if (await menuBtn.count() > 0) {
          await menuBtn.click()
          await page.waitForTimeout(600)
          const imgOption = page.locator('button:has-text("画像")').first()
          if (await imgOption.count() > 0 && await imgOption.isVisible()) {
            await imgOption.click()
            await page.waitForTimeout(500)
            const fileInput = page.locator('input[type="file"]').first()
            if (await fileInput.count() > 0) {
              await fileInput.setInputFiles(bodyImagePath)
              await page.waitForTimeout(2500)
              // 本文画像も同様にクロップ確認モーダルが出る場合がある
              const cropSaveBtn = page.locator('button:has-text("保存")').first()
              if (await cropSaveBtn.count() > 0 && await cropSaveBtn.isVisible()) {
                await cropSaveBtn.click({ force: true })
                await page.waitForTimeout(1500)
              }
              console.log('✅ 本文中画像挿入完了')
            } else {
              console.log('⚠️ 本文画像: file inputが見つからず')
            }
          } else {
            console.log('⚠️ 本文画像: 「画像」メニュー項目が見えない')
          }
        } else {
          console.log('⚠️ 本文画像: メニューを開くボタンが見つからず')
        }
      } catch (e) {
        console.log('⚠️ 本文画像挿入失敗:', e.message)
      }
      await saveScreenshot(page, '06c-body-image')
    }

    // ── ⑧ 公開 ───────────────────────────────────────────────
    console.log('🚀 公開中...')
    await page.waitForTimeout(1000)

    const publishBtn = page.locator('button:has-text("公開に進む")').first()
    await publishBtn.click({ timeout: 10000 })
    await page.waitForTimeout(2000)
    await saveScreenshot(page, '07-publish-dialog')

    // 公開設定ダイアログ内の最終投稿ボタン
    const confirmBtn = page.locator('button:has-text("投稿する")').first()
    const confirmCount = await confirmBtn.count()
    if (confirmCount > 0) {
      await confirmBtn.click()
      await page.waitForTimeout(3000)
    } else {
      console.log('⚠️ 「投稿する」ボタンが見つからず、公開できていない可能性')
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
