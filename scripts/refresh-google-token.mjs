#!/usr/bin/env node
/**
 * Google OAuth リフレッシュトークン再取得スクリプト
 *
 * 使い方:
 *   node scripts/refresh-google-token.mjs
 *
 * 表示されたURLをブラウザで開き、認証コードをペーストすると
 * 新しいリフレッシュトークンが表示されます。
 * それを GitHub Secrets の GOOGLE_OAUTH_REFRESH_TOKEN に設定してください。
 */

import { google } from 'googleapis'
import * as readline from 'readline'

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ 環境変数が未設定です。')
  console.error('   export GOOGLE_OAUTH_CLIENT_ID=your_client_id')
  console.error('   export GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret')
  process.exit(1)
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob'
)

const SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
]

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent', // 必ずrefresh_tokenを返すようにする
})

console.log('\n🔗 以下のURLをブラウザで開いて、Googleアカウントでログインしてください:\n')
console.log(authUrl)
console.log('\n認証後に表示される「コード」をコピーしてください。\n')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
rl.question('認証コードを貼り付けてEnter: ', async (code) => {
  rl.close()
  try {
    const { tokens } = await oauth2Client.getToken(code.trim())
    console.log('\n✅ 新しいリフレッシュトークン取得成功!\n')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('GOOGLE_OAUTH_REFRESH_TOKEN=')
    console.log(tokens.refresh_token)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('\n📋 次のステップ:')
    console.log('1. 上のトークンをコピー')
    console.log('2. GitHub → Settings → Secrets → GOOGLE_OAUTH_REFRESH_TOKEN を更新')
  } catch (err) {
    console.error('❌ トークン取得エラー:', err.message)
  }
})
