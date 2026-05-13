#!/usr/bin/env node
/**
 * note.com 自動投稿スクリプト
 *
 * 動作：
 * 1. Playwrightでnote.comにログイン
 * 2. 記事タイトル・本文を入力して公開
 *
 * 環境変数：
 *   NOTE_EMAIL    - noteのメールアドレス
 *   NOTE_PASSWORD - noteのパスワード
 *   NOTE_TITLE    - 投稿タイトル
 *   NOTE_BODY     - 投稿本文（Markdown → プレーンテキスト）
 */

import { chromium } from 'playwright'

export async function postToNote(title, body) {
  const email = process.env.NOTE_EMAIL
  const password = process.env.NOTE_PASSWORD

  if (!email || !password) {
    throw new Error('NOTE_EMAIL / NOTE_PASSWORD が設定されていません')
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()

  try {
    // ログイン
    console.log('📝 noteにログイン中...')
    await page.goto('https://note.com/login', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)

    // メールアドレス入力（複数セレクターを試行）
    const emailSelectors = [
      'input[name="email"]',
      'input[type="email"]',
      'input[placeholder*="メール"]',
      'input[placeholder*="email"]',
      '#email',
    ]
    let emailFilled = false
    for (const sel of emailSelectors) {
      try {
        await page.fill(sel, email, { timeout: 5000 })
        emailFilled = true
        console.log(`✅ メール入力: ${sel}`)
        break
      } catch {}
    }
    if (!emailFilled) throw new Error('メールアドレス入力欄が見つかりません')

    // パスワード入力
    const passwordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
      'input[placeholder*="パスワード"]',
      '#password',
    ]
    let passwordFilled = false
    for (const sel of passwordSelectors) {
      try {
        await page.fill(sel, password, { timeout: 5000 })
        passwordFilled = true
        console.log(`✅ パスワード入力: ${sel}`)
        break
      } catch {}
    }
    if (!passwordFilled) throw new Error('パスワード入力欄が見つかりません')

    // ログインボタンをクリック
    const loginBtnSelectors = [
      'button[type="submit"]',
      'button:has-text("ログイン")',
      'button:has-text("サインイン")',
      'input[type="submit"]',
      'button:has-text("続ける")',
      'button:has-text("次へ")',
    ]
    let loginClicked = false
    for (const sel of loginBtnSelectors) {
      try {
        await page.click(sel, { timeout: 5000 })
        loginClicked = true
        console.log(`✅ ログインボタンクリック: ${sel}`)
        break
      } catch {}
    }
    if (!loginClicked) throw new Error('ログインボタンが見つかりません')

    await page.waitForTimeout(4000)
    console.log('✅ ログイン完了')

    // 新規記事作成ページへ
    console.log('✍️ 新規記事を作成中...')
    await page.goto('https://note.com/notes/new', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // タイトル入力
    const titleSelector = '[placeholder="タイトル"], [data-placeholder="タイトル"], .title-input, textarea[class*="title"]'
    await page.waitForSelector(titleSelector, { timeout: 10000 })
    await page.click(titleSelector)
    await page.fill(titleSelector, title)

    // 本文入力（Markdownをプレーンテキストに変換）
    const plainBody = body
      .replace(/^#+\s+/gm, '')           // 見出しのシャープを除去
      .replace(/\*\*(.+?)\*\*/g, '$1')   // 太字
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // リンク
      .replace(/^>\s*/gm, '')             // 引用
      .replace(/`(.+?)`/g, '$1')          // インラインコード
      .trim()

    const bodySelector = '[placeholder="本文を書く"], [data-placeholder="本文"], .ProseMirror, [contenteditable="true"]:not([class*="title"])'
    await page.waitForSelector(bodySelector, { timeout: 10000 })
    await page.click(bodySelector)
    await page.keyboard.type(plainBody, { delay: 5 })

    // 公開ボタンをクリック
    await page.waitForTimeout(1000)
    const publishBtn = page.locator('button:has-text("公開"), button:has-text("投稿")')
    await publishBtn.first().click()
    await page.waitForTimeout(2000)

    // 公開確認ダイアログ
    const confirmBtn = page.locator('button:has-text("公開する"), button:has-text("投稿する")')
    if (await confirmBtn.count() > 0) {
      await confirmBtn.first().click()
      await page.waitForTimeout(3000)
    }

    const url = page.url()
    console.log(`✅ note投稿完了: ${url}`)
    return url

  } finally {
    await browser.close()
  }
}
