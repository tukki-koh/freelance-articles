#!/usr/bin/env node
/**
 * note.com セッション初期設定スクリプト
 *
 * 一回だけ実行してください。
 * ブラウザが開くので、Googleアカウントでログインしてください。
 * ログイン後、Enterキーを押すとセッションが保存されます。
 */

import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as readline from 'readline'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SESSION_FILE = join(__dirname, '.note-session.json')

function waitForEnter(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, () => {
      rl.close()
      resolve()
    })
  })
}

const browser = await chromium.launch({
  headless: false,
  args: ['--no-sandbox'],
})

const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 800 },
  locale: 'ja-JP',
})

const page = await context.newPage()
await page.goto('https://note.com/login', { waitUntil: 'networkidle', timeout: 30000 })

console.log('')
console.log('========================================')
console.log('  ブラウザが開きました')
console.log('  Googleボタンでnote.comにログインして')
console.log('  ログイン完了後、ここでEnterを押してください')
console.log('========================================')
console.log('')

// トップページを見られるだけでは不十分（未ログインでも見られる）。
// 実際に投稿できるかどうかを、ログイン必須の記事作成ページで確認する。
let ok = false
for (let i = 0; i < 5 && !ok; i++) {
  await waitForEnter('ログイン完了後、Enterを押してください: ')
  await page.goto('https://note.com/notes/new', { waitUntil: 'networkidle', timeout: 60000 })
  if (page.url().includes('/login')) {
    console.log('❌ まだログインできていません（記事作成ページがログイン画面に戻されました）。')
    console.log('   ブラウザでログインを完了してから、もう一度Enterを押してください。')
  } else {
    ok = true
  }
}
if (!ok) {
  console.log('❌ ログインを確認できませんでした。中止します。')
  await browser.close()
  process.exit(1)
}
console.log('✅ 記事作成ページを開けました（ログイン成立）')

const storageState = await context.storageState()
writeFileSync(SESSION_FILE, JSON.stringify(storageState, null, 2))

console.log(`✅ セッションを保存しました: ${SESSION_FILE}`)
console.log('   次回からnote自動投稿スクリプトが使えます。')

await browser.close()
