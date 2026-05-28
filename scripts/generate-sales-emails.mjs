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
 *   3. sales/drafts/ フォルダにMarkdownファイルとして保存
 *   4. GitHubにコミット → リポジトリで内容を確認してGmailからコピペ送信
 */

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DRAFTS_DIR = join(ROOT, 'sales', 'drafts')

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY が未設定です')

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

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
- 部署: ${target.department || '採用・コーポレート'}
- 業種: ${target.industry || ''}
- メモ: ${target.note || ''}

## 採用するメールテンプレート（ベース）

件名: フリーランス新法、御社の業務委託契約は大丈夫ですか？

[部署名]ご担当者様

突然のご連絡、失礼いたします。

2024年11月施行のフリーランス新法により、業務委託契約に新たな規制が課されました。違反した場合、行政指導・社名公表・罰則の対象となります。

弊社の「FreelanceContractAI」では、御社の既存契約書をアップロードするだけで、30秒・500円〜で法的リスク箇所を自動特定。コンプライアンスリスクを事前に排除できます。

まずは無料デモをご覧ください。
→ https://freelance-contract-checker.vercel.app

FreelanceContractAI
月足昂誠

## 指示
- 上記テンプレートをベースに、業種・メモ情報を活かして1〜2箇所だけ個別化してください
- 200字以内に収めてください（件名除く）
- 一斉送信に見えないよう自然な文体にしてください

## 出力形式（JSONのみ）
{"subject":"件名","body":"本文（署名含む）"}
`.trim()

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].text
  const json = text.match(/\{[\s\S]+\}/)?.[0]
  return JSON.parse(json)
}

// ── B2C メール生成 ────────────────────────────────────────────
async function generateB2CEmail(target) {
  const prompt = `
フリーランス契約書AIチェックSaaS「FreelanceContractAI」の個人向け案内メールを1通作成してください。

ターゲット情報:
- 名前: ${target.name || 'フリーランスの方'}
- 職種: ${target.occupation || ''}
- 経験年数: ${target.years_experience || ''}年
- メモ: ${target.notes || ''}

## 指示
- フリーランス新法（2024年11月施行）の違反リスクを契約前に無料でチェックできることを伝える
- 親しみやすい文体（です・ます調）
- 150字以内（件名除く）

## 出力形式（JSONのみ）
{"subject":"件名","body":"本文（署名含む）"}
`.trim()

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].text
  const json = text.match(/\{[\s\S]+\}/)?.[0]
  return JSON.parse(json)
}

// ── Markdownファイルに保存 ────────────────────────────────────
function saveDrafts(emails, type) {
  mkdirSync(DRAFTS_DIR, { recursive: true })

  const date = new Date().toISOString().slice(0, 10)
  const filePath = join(DRAFTS_DIR, `${date}-${type}.md`)

  const lines = [
    `# 営業メール下書き（${type.toUpperCase()}）`,
    `生成日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
    `件数: ${emails.length}件`,
    '',
    '---',
    '',
  ]

  for (const { to, subject, body } of emails) {
    lines.push(`## 📧 宛先: ${to}`)
    lines.push('')
    lines.push(`**件名:** ${subject}`)
    lines.push('')
    lines.push('**本文:**')
    lines.push('')
    lines.push('```')
    lines.push(body)
    lines.push('```')
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  writeFileSync(filePath, lines.join('\n'), 'utf-8')
  return filePath
}

// ── メイン ────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2)
  const typeArg = args.find(a => a.startsWith('--type='))?.split('=')[1]
    || args[args.indexOf('--type') + 1]
    || 'both'

  console.log(`📧 営業メール自動生成開始 (type: ${typeArg})\n`)

  // ── B2B ──────────────────────────────────────────────────────
  if (typeArg === 'b2b' || typeArg === 'both') {
    const b2bFile = join(ROOT, 'sales', 'targets-b2b.csv')
    if (!existsSync(b2bFile)) {
      console.log('⚠️  sales/targets-b2b.csv が見つかりません')
    } else {
      const allTargets = parseCSV(b2bFile)
      const targets = allTargets.filter(t => (t.status || 'active') !== 'bounced' && (t.status || 'active') !== 'skip')
      const bounced = allTargets.filter(t => t.status === 'bounced')
      const skipped = allTargets.filter(t => t.status === 'skip')

      console.log(`📋 B2B: ${targets.length}社のメールを生成中...`)
      if (bounced.length > 0) console.log(`⏭️  バウンス済みスキップ: ${bounced.length}社`)
      if (skipped.length > 0) console.log(`⏭️  手動スキップ: ${skipped.length}社`)

      const emails = []

      for (const target of targets) {
        try {
          process.stdout.write(`  → ${target.company_name} ... `)
          const email = await generateB2BEmail(target)
          emails.push({ to: target.contact_email, ...email })
          console.log('✅')
        } catch (err) {
          console.log(`❌ (${err.message})`)
        }
      }

      const savedPath = saveDrafts(emails, 'b2b')
      console.log(`\n💾 保存完了: ${savedPath.replace(ROOT + '/', '')}`)
      console.log(`   ${emails.length}件のメールが保存されました`)

      // バウンス会社のコンタクトフォームを表示
      if (bounced.length > 0) {
        console.log(`\n📬 バウンス済み企業のコンタクトフォーム（手動で送信してください）:`)
        for (const t of bounced) {
          if (t.contact_form_url) {
            console.log(`   ${t.company_name}: ${t.contact_form_url}`)
          } else {
            console.log(`   ${t.company_name}: コンタクトフォームURLを調べて手動送信してください`)
          }
        }
      }
    }
  }

  // ── B2C ──────────────────────────────────────────────────────
  if (typeArg === 'b2c' || typeArg === 'both') {
    const b2cFile = join(ROOT, 'sales', 'targets-b2c.csv')
    if (!existsSync(b2cFile)) {
      console.log('⚠️  sales/targets-b2c.csv が見つかりません')
    } else {
      const targets = parseCSV(b2cFile)
      console.log(`\n📋 B2C: ${targets.length}件のメールを生成中...`)
      const emails = []

      for (const target of targets) {
        try {
          process.stdout.write(`  → ${target.name} ... `)
          const email = await generateB2CEmail(target)
          emails.push({ to: target.email, ...email })
          console.log('✅')
        } catch (err) {
          console.log(`❌ (${err.message})`)
        }
      }

      const savedPath = saveDrafts(emails, 'b2c')
      console.log(`\n💾 保存完了: ${savedPath.replace(ROOT + '/', '')}`)
      console.log(`   ${emails.length}件のメールが保存されました`)
    }
  }

  console.log('\n🎉 完了！GitHubリポジトリの sales/drafts/ フォルダを確認してください')

  // GitHub Actions サマリー
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('fs')
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## 📧 営業メール生成完了\n\n` +
      `- リポジトリの \`sales/drafts/\` フォルダにMarkdownで保存されました\n` +
      `- 内容を確認してGmailからコピペ送信してください\n`
    )
  }
}

main().catch(err => {
  console.error('❌ エラー:', err.message)
  process.exit(1)
})
