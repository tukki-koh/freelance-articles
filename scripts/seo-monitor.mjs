#!/usr/bin/env node
/**
 * Google Search Console SEO自動監視 → Claude記事改善スクリプト
 *
 * 動作：
 * 1. Search Console APIで各記事の検索パフォーマンスを取得
 * 2. 平均順位20位以下 または CTR 1%未満の記事を抽出
 * 3. Claude APIで記事を改善（SEOタイトル・見出し・本文の最適化）
 * 4. GitHubのmainブランチに直接コミット（Vercel自動デプロイ）
 *
 * 必要な環境変数：
 *   GOOGLE_SERVICE_ACCOUNT_KEY  - サービスアカウントJSON（base64エンコード）
 *   ANTHROPIC_API_KEY           - Claude API キー
 *   GITHUB_TOKEN                - GitHub Actions自動提供
 *   GITHUB_REPOSITORY           - owner/repo形式
 */

import { google } from 'googleapis'
import Anthropic from '@anthropic-ai/sdk'
import { Octokit } from '@octokit/rest'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const SITE_URL = 'https://freelance-articles.vercel.app'
const POSITION_THRESHOLD = 20   // 平均順位がこれ以下なら改善対象
const CTR_THRESHOLD = 0.01      // CTRがこれ未満なら改善対象（1%）
const DAYS = 28                 // 分析期間（日）

// 記事スラッグとファイル名のマッピング
const ARTICLE_FILES = [
  { slug: '60day-rule-violation',         file: '01_60day-rule-violation.md' },
  { slug: 'contract-checklist',           file: '02_contract-checklist.md' },
  { slug: 'price-undercutting',           file: '03_price-undercutting.md' },
  { slug: 'late-payment-response',        file: '04_late-payment-response.md' },
  { slug: 'subcontract-law-applicability',file: '05_subcontract-law-applicability.md' },
  { slug: 'instant-termination-illegal',  file: '06_instant-termination-illegal.md' },
  { slug: 'return-prohibition',           file: '07_return-prohibition.md' },
  { slug: 'sme-freelance-ordering-caution', file: '08_sme-freelance-ordering-caution.md' },
  { slug: 'revision-cost-liability',      file: '09_revision-cost-liability.md' },
  { slug: 'harassment-prevention',        file: '10_harassment-prevention.md' },
]

// ================================================================
// Step 1: Search Console APIで検索パフォーマンスを取得
// ================================================================
async function getSearchPerformance() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY が設定されていません')
  }

  const credentials = JSON.parse(Buffer.from(keyJson.replace(/\s/g, ''), 'base64').toString('utf8'))

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  })

  const searchConsole = google.searchconsole({ version: 'v1', auth })

  const endDate = new Date().toISOString().slice(0, 10)
  const startDate = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  console.log(`📊 Search Console データ取得: ${startDate} 〜 ${endDate}`)

  const response = await searchConsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate,
      endDate,
      dimensions: ['page'],
      rowLimit: 100,
    },
  })

  return response.data.rows ?? []
}

// ================================================================
// Step 2: 改善が必要な記事を特定
// ================================================================
function findLowPerformingArticles(rows) {
  const results = []

  for (const { slug, file } of ARTICLE_FILES) {
    const pageUrl = `${SITE_URL}/articles/${slug}`
    const row = rows.find(r => r.keys?.[0] === pageUrl)

    if (!row) {
      // データなし = インデックス未登録または完全に低順位
      results.push({ slug, file, reason: 'データなし（インデックス未登録の可能性）', position: 999, ctr: 0, clicks: 0 })
      continue
    }

    const position = row.position ?? 999
    const ctr = row.ctr ?? 0
    const clicks = row.clicks ?? 0
    const impressions = row.impressions ?? 0

    console.log(`  ${slug}: 順位${position.toFixed(1)} CTR${(ctr * 100).toFixed(1)}% クリック${clicks} 表示${impressions}`)

    if (position > POSITION_THRESHOLD || (ctr < CTR_THRESHOLD && impressions > 10)) {
      results.push({
        slug,
        file,
        reason: position > POSITION_THRESHOLD
          ? `平均順位 ${position.toFixed(1)}位（目標：20位以内）`
          : `CTR ${(ctr * 100).toFixed(1)}%（目標：1%以上）`,
        position,
        ctr,
        clicks,
        impressions,
      })
    }
  }

  // 順位が悪い順（改善効果が大きい順）に並び替え
  results.sort((a, b) => b.position - a.position)

  // 一度に改善するのは最大2記事（API費用・作業量の最適化）
  return results.slice(0, 2)
}

// ================================================================
// Step 3: Claude APIで記事を改善
// ================================================================
async function improveArticle(slug, file, reason) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // 現在の記事内容を読む
  const filePath = join(ROOT, file)
  if (!existsSync(filePath)) {
    console.warn(`⚠️ ファイルが見つかりません: ${file}`)
    return null
  }

  const currentContent = readFileSync(filePath, 'utf8')
  const titleMatch = currentContent.match(/^#\s+(.+)$/m)
  const currentTitle = titleMatch?.[1] ?? slug

  console.log(`\n✍️ 改善中: ${currentTitle}`)
  console.log(`   理由: ${reason}`)

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `あなたはフリーランス新法・下請法の専門SEOライターです。
以下の記事のSEO順位が低い（${reason}）ため、検索上位表示を目指して改善してください。

【現在の記事】
${currentContent}

【改善要件】
1. タイトル（H1）: 検索ボリュームが高く、クリックされやすい具体的なキーワードを含める
   例：「フリーランス新法 支払い遅延 罰則 完全ガイド【2024年最新版】」
2. メタディスクリプション: クリック率を上げる魅力的な文（120字以内）
3. 見出し構成（H2・H3）: 検索クエリに答える見出しを追加
4. 本文: 以下を強化
   - 具体的な金額・日数・条文番号を含める
   - よくある質問（FAQ形式）を1〜2問追加
   - 「〜とは？」「〜の方法」など検索意図に合ったフレーズを増やす
5. 文字数: 1400〜1800字（現在より増やす）
6. CTAは変更不可:
   > **👉 契約書のリスクをAIでチェック → https://freelance-contract-checker.vercel.app**

改善した記事本文のみ出力。説明・前置き不要。`,
    }],
  })

  return message.content[0].text
}

// ================================================================
// Step 4: GitHubにコミット
// ================================================================
async function commitImprovedArticle(slug, file, content) {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/')

  // 既存ファイルのSHAを取得
  let existingSha
  try {
    const { data: existing } = await octokit.repos.getContent({ owner, repo, path: file })
    existingSha = existing.sha
  } catch {
    // 新規ファイル
  }

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: file,
    message: `seo: 検索順位改善のため記事「${slug}」を自動リライト`,
    content: Buffer.from(content).toString('base64'),
    branch: 'main',
    ...(existingSha ? { sha: existingSha } : {}),
  })

  console.log(`✅ コミット完了: ${file}`)
}

// ================================================================
// レポート出力
// ================================================================
function printReport(lowArticles, allRows) {
  console.log('\n📋 SEO監視レポート')
  console.log('='.repeat(50))

  if (allRows.length === 0) {
    console.log('⚠️ Search Consoleにデータがありません。サイトが新しい場合はインデックス登録をお待ちください。')
    return
  }

  console.log(`\n改善対象: ${lowArticles.length}件`)
  lowArticles.forEach(a => {
    console.log(`  • ${a.slug}`)
    console.log(`    ${a.reason}`)
  })

  const goodArticles = ARTICLE_FILES.filter(a =>
    !lowArticles.find(l => l.slug === a.slug)
  )
  if (goodArticles.length > 0) {
    console.log(`\n✅ 順調な記事: ${goodArticles.length}件`)
    goodArticles.forEach(a => console.log(`  • ${a.slug}`))
  }
}

// ================================================================
// メイン処理
// ================================================================
async function main() {
  console.log('🔍 SEO監視スクリプト開始\n')

  // Search Consoleデータ取得
  const rows = await getSearchPerformance()
  console.log(`\n📊 全ページのパフォーマンス:`)

  // 改善対象を特定
  const lowArticles = findLowPerformingArticles(rows)
  printReport(lowArticles, rows)

  if (lowArticles.length === 0) {
    console.log('\n🎉 全記事が基準を満たしています！')
    return
  }

  // GitHub情報がない場合はスキップ（ローカルテスト用）
  const canCommit = !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY)

  for (const article of lowArticles) {
    console.log(`\n🔧 改善処理: ${article.slug}`)

    const improvedContent = await improveArticle(article.slug, article.file, article.reason)
    if (!improvedContent) continue

    if (canCommit) {
      await commitImprovedArticle(article.slug, article.file, improvedContent)
      console.log(`🚀 Vercel自動デプロイ開始（約1〜2分で反映）`)
    } else {
      // ローカルテスト: 改善内容を表示
      console.log('\n--- 改善後プレビュー（先頭300字）---')
      console.log(improvedContent.slice(0, 300))
      console.log('...')
    }
  }

  console.log('\n✅ SEO改善完了！')
}

main().catch(err => {
  console.error('❌ エラー:', err.message)
  process.exit(1)
})
