#!/usr/bin/env node
/**
 * 営業メール自動生成スクリプト
 *
 * 使い方:
 *   node scripts/generate-sales-emails.mjs --type b2b   # 企業向け
 *   node scripts/generate-sales-emails.mjs --type b2c   # フリーランス個人向け
 *   node scripts/generate-sales-emails.mjs --type both  # 両方（デフォルト）
 *
 * 動作:
 *   1. sales/targets-b2b.csv または targets-b2c.csv を読み込む
 *   2. Claude AIで各ターゲット向けに個別メールを生成
 *   3. Gmailの下書きに自動保存
 *   4. あなたがGmailで確認して送信ボタンを押すだけ
 */

import { google } from 'googleapis'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ── 環境変数 ─────────────────────────────────────────────────
const GMAIL_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID
const GMAIL_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN
const GMAIL_FROM = process.env.GMAIL_FROM_EMAIL || 'yuezuangcheng@gmail.com'
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

if (!GMAIL_REFRESH_TOKEN) throw new Error('GMAIL_REFRESH_TOKEN が未設定です')
if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY が未設定です')

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

// ── Gmail クライアント ────────────────────────────────────────
function createGmailClient() {
  const auth = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET)
  auth.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN })
  return google.gmail({ version: 'v1', auth })
}

// ── CSVパーサー ───────────────────────────────────────────────
function parseCSV(filePath) {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim())
  return lines.slice(1)
    .filter(line => line.trim())
    .map(line => {
      const values = line.split(',').map(v => v.trim())
      return Object.fromEntries(headers.map((h, i) => [h, values[i] || '']))
    })
}

// ── B2B メール生成 ────────────────────────────────────────────
async function generateB2BEmail(target) {
  const prompt = `
フリーランス契約書AIチェックSaaS「FreelanceContractAI」の営業メールを1通作成してください。

ターゲット情報:
- 会社名: ${target.company_name}
- 部署: ${target.department || ''}
- 業種: ${target.industry || ''}
- メモ: ${target.note || ''}

## 採用するメールテンプレート（ベース）

件名: フリーランス新法、御社の業務委託契約は大丈夫ですか？

[担当者名] 様

突然のご連絡、失礼いたします。

2024年11月施行のフリーランス新法により、業務委託契約に新たな規制が課されました。違反した場合、行政指導・社名公表・罰則の対象となります。

弊社の「FreelanceContractAI」では、御社の既存契約書をアップロードするだけで、30秒・500円〜で法的リスク箇所を自動特定。コンプライアンスリスクを事前に排除できます。

まずは無料デモをご覧ください。
→ https://freelance-contract-checker.vercel.app

FreelanceContractAI
月足昂誠

## 指示
- 上記テンプレートをベースに、業種・部署・メモ情報を活かして自然に個別化してください
- [担当者名] は実際の宛名に置き換えてください（department情報を使用）
- 会社名を冒頭の宛名に組み込んでください
- 200字以内に収めてください（件名除く）
- 一斉送信に見えないよう、1〜2箇所だけ個別情報を織り交ぜてください

## 出力形式（JSONのみ、余計なテキスト不要）
{
  "subject": "件名",
  "body": "本文（署名含む）"
}
`.trim()

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].text
  const json = text.match(/\{[\s\S]+\}/)?.[0]
  return JSON.parse(json)
}

// ── B2C メール生成 ────────────────────────────────────────────
async function generateB2CEmail(target) {
  const prompt = `
フリーランス契約書AIチェックSaaS「FreelanceContractAI」の営業メールを1通作成してください。

ターゲット情報:
- 名前: ${target.name}
- 職種: ${target.occupation || 'フリーランス'}
- メモ: ${target.note || ''}

## 採用するメールテンプレート（ベース）

件名: その業務委託契約、サインする前に30秒だけ確認してください

[名前] さん

「報酬の支払い条件が曖昧」「一方的な修正依頼が来た」——フリーランスの方からそんな声を多く聞きます。

2024年11月施行のフリーランス新法により、発注側には書面交付・条件提示が義務づけられました。あなたが受け取った契約書が、その義務を果たしているか、500円・30秒でチェックできます。

泣き寝入りする前に、まず契約書を診断してください。
→ https://freelance-contract-checker.vercel.app

FreelanceContractAI
月足昂誠

## 指示
- 職種情報を使って1〜2箇所自然に個別化してください
- 名前を宛名に使用してください（さん付け）
- 150字以内に収めてください（件名除く）
- 親しみやすいトーンで

## 出力形式（JSONのみ）
{
  "subject": "件名",
  "body": "本文（署名含む）"
}
`.trim()

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].text
  const json = text.match(/\{[\s\S]+\}/)?.[0]
  return JSON.parse(json)
}

// ── Gmail 下書き作成 ──────────────────────────────────────────
async function createGmailDraft(gmail, to, subject, body) {
  const emailLines = [
    `From: ${GMAIL_FROM}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body).toString('base64'),
  ]
  const raw = Buffer.from(emailLines.join('\r\n')).toString('base64url')

  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw } },
  })

  return response.data.id
}

// ── メイン ────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2)
  const typeArg = args.find(a => a.startsWith('--type='))?.split('=')[1]
    || (args[args.indexOf('--type') + 1])
    || 'both'

  const gmail = createGmailClient()

  let b2bCount = 0
  let b2cCount = 0

  // ── B2B ────────────────────────────────────────────────────
  if (typeArg === 'b2b' || typeArg === 'both') {
    const b2bFile = join(ROOT, 'sales', 'targets-b2b.csv')
    if (!existsSync(b2bFile)) {
      console.log('⚠️  sales/targets-b2b.csv が見つかりません')
    } else {
      const targets = parseCSV(b2bFile)
      console.log(`\n📧 B2B メール生成中... (${targets.length}件)`)

      for (const target of targets) {
        try {
          console.log(`  → ${target.company_name}`)
          const email = await generateB2BEmail(target)
          const draftId = await createGmailDraft(gmail, target.contact_email, email.subject, email.body)
          console.log(`  ✅ 下書き保存完了 (draft: ${draftId})`)
          b2bCount++
        } catch (err) {
          console.error(`  ❌ ${target.company_name}: ${err.message}`)
        }
      }
    }
  }

  // ── B2C ────────────────────────────────────────────────────
  if (typeArg === 'b2c' || typeArg === 'both') {
    const b2cFile = join(ROOT, 'sales', 'targets-b2c.csv')
    if (!existsSync(b2cFile)) {
      console.log('⚠️  sales/targets-b2c.csv が見つかりません')
    } else {
      const targets = parseCSV(b2cFile)
      console.log(`\n📧 B2C メール生成中... (${targets.length}件)`)

      for (const target of targets) {
        try {
          console.log(`  → ${target.name}`)
          const email = await generateB2CEmail(target)
          const draftId = await createGmailDraft(gmail, target.email, email.subject, email.body)
          console.log(`  ✅ 下書き保存完了 (draft: ${draftId})`)
          b2cCount++
        } catch (err) {
          console.error(`  ❌ ${target.name}: ${err.message}`)
        }
      }
    }
  }

  console.log(`\n🎉 完了！`)
  console.log(`   B2B: ${b2bCount}件 / B2C: ${b2cCount}件 → Gmail下書きに保存されました`)
  console.log(`   Gmailを開いて確認・送信してください`)
  console.log(`   → https://mail.google.com/#drafts`)
}

main().catch(err => {
  console.error('❌ エラー:', err.message)
  process.exit(1)
})
