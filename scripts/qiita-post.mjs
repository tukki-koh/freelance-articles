#!/usr/bin/env node
/**
 * Qiita 定期投稿スクリプト
 *
 * 動作：
 * 1. .qiita-state.json で「次に投稿する記事インデックス」を管理
 * 2. 記事をQiita用に整形（CTA文言をQiita向けに調整）
 * 3. Qiita APIで投稿
 * 4. 投稿済みインデックスを更新
 *
 * 必要な環境変数:
 *   QIITA_TOKEN  - Qiitaのパーソナルアクセストークン（設定→アプリケーション→トークン発行）
 *
 * Qiitaトークンに必要なスコープ: read_qiita, write_qiita
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const STATE_FILE = join(__dirname, '.qiita-state.json')
const SITE_URL = 'https://freelance-articles.vercel.app'
const CHECKER_URL = 'https://freelance-contract-checker.vercel.app'

// ================================================================
// 投稿対象記事リスト（全18本）
// ================================================================
const ARTICLE_FILES = [
  { slug: '60day-rule-violation',           file: '01_60day-rule-violation.md',           tags: ['フリーランス', 'フリーランス新法', '契約', '業務委託'] },
  { slug: 'contract-checklist',             file: '02_contract-checklist.md',              tags: ['フリーランス', '契約書', 'チェックリスト', '業務委託'] },
  { slug: 'price-undercutting',             file: '03_price-undercutting.md',              tags: ['フリーランス', 'フリーランス新法', '買いたたき'] },
  { slug: 'late-payment-response',          file: '04_late-payment-response.md',           tags: ['フリーランス', '未払い', '業務委託'] },
  { slug: 'subcontract-law-applicability',  file: '05_subcontract-law-applicability.md',   tags: ['フリーランス', '下請法', '業務委託'] },
  { slug: 'instant-termination-illegal',    file: '06_instant-termination-illegal.md',     tags: ['フリーランス', 'フリーランス新法', '契約解除'] },
  { slug: 'return-prohibition',             file: '07_return-prohibition.md',              tags: ['フリーランス', 'フリーランス新法', '返品禁止'] },
  { slug: 'sme-freelance-ordering-caution', file: '08_sme-freelance-ordering-caution.md',  tags: ['フリーランス', '発注', 'コンプライアンス'] },
  { slug: 'revision-cost-liability',        file: '09_revision-cost-liability.md',         tags: ['フリーランス', '修正費用', '業務委託'] },
  { slug: 'harassment-prevention',          file: '10_harassment-prevention.md',           tags: ['フリーランス', 'ハラスメント', 'フリーランス新法'] },
  { slug: 'freelance-law-applicable-check', file: '11_freelance-law-applicable-check.md',  tags: ['フリーランス', 'フリーランス新法'] },
  { slug: 'dangerous-contract-clauses',     file: '12_dangerous-contract-clauses.md',      tags: ['フリーランス', '契約書', '業務委託'] },
  { slug: 'unpaid-freelance-response',      file: '13_unpaid-freelance-response.md',       tags: ['フリーランス', '未払い', 'フリーランス新法'] },
  { slug: 'ordering-side-compliance',       file: '14_ordering-side-compliance.md',        tags: ['フリーランス', '発注', 'コンプライアンス'] },
  { slug: 'freelance-law-vs-subcontract-law',file:'15_freelance-law-vs-subcontract-law.md',tags: ['フリーランス', '下請法', 'フリーランス新法'] },
  { slug: 'gyomu-itaku-keiyakusho-check',   file: '17_gyomu-itaku-keiyakusho-check.md',   tags: ['フリーランス', '契約書', 'チェックリスト', '業務委託'] },
  { slug: 'freelance-miharai-jiko',         file: '18_freelance-miharai-jiko.md',          tags: ['フリーランス', '未払い', '時効', '少額訴訟'] },
]

// ================================================================
// State 管理
// ================================================================
function loadState() {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  return { nextIndex: 0, postedSlugs: [] }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// ================================================================
// 記事コンテンツ整形
// ================================================================
function formatForQiita(content, slug) {
  // Qiita向けにCTA文言を調整
  let body = content

  // H1タイトルを除去（Qiitaはtitleフィールドで管理）
  body = body.replace(/^#\s+.+\n/, '')

  // CTAリンクをQiita向けに調整
  body = body.replace(
    /👉 契約書のリスクをAIでチェック → https:\/\/freelance-contract-checker\.vercel\.app/g,
    `👉 **契約書のリスクをAIでチェック** → [freelance-contract-checker.vercel.app](${CHECKER_URL})\n\nフリーランス新法・下請法の全条項に照らして30秒で自動診断。違反条項を条文番号付きで指摘し、修正案まで提示。**無料登録で1回お試し可能**（クレジットカード不要）。`
  )

  // 記事サイトへの参照を追加
  body = body.trim()
  body += `\n\n---\n\n## 関連記事\n\nフリーランス新法・下請法の解説記事をまとめています。\n\n👉 [フリーランス新法 完全ガイド（全${ARTICLE_FILES.length}記事）](${SITE_URL})\n`

  return body
}

function extractTitle(content) {
  const match = content.match(/^#\s+(.+)$/m)
  return match ? match[1] : 'フリーランス新法解説'
}

// ================================================================
// Qiita API 投稿
// ================================================================
async function postToQiita(title, body, tags) {
  const token = process.env.QIITA_TOKEN
  if (!token) throw new Error('QIITA_TOKEN が設定されていません')

  const tagObjects = tags.map(name => ({ name, versions: [] }))

  const res = await fetch('https://qiita.com/api/v2/items', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      body,
      tags: tagObjects,
      private: false,
      tweet: false,
      slide: false,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Qiita API エラー ${res.status}: ${err}`)
  }

  return await res.json()
}

// ================================================================
// メイン
// ================================================================
async function main() {
  console.log('📝 Qiita 定期投稿スクリプト開始\n')

  const token = process.env.QIITA_TOKEN
  if (!token) {
    console.warn('⚠️ QIITA_TOKEN が設定されていません')
    console.warn('   GitHub Secrets に QIITA_TOKEN を追加してください')
    console.warn('   取得方法: Qiita → 設定 → アプリケーション → 個人用アクセストークン発行')
    console.warn('   必要なスコープ: read_qiita, write_qiita')
    process.exit(0) // ワークフロー失敗にしない
  }

  const state = loadState()
  const article = ARTICLE_FILES[state.nextIndex % ARTICLE_FILES.length]

  console.log(`📄 投稿対象: ${article.slug} (${state.nextIndex + 1}/${ARTICLE_FILES.length})`)

  const filePath = join(ROOT, article.file)
  if (!existsSync(filePath)) {
    console.warn(`⚠️ ファイルが見つかりません: ${article.file}`)
    state.nextIndex = (state.nextIndex + 1) % ARTICLE_FILES.length
    saveState(state)
    process.exit(0)
  }

  const content = readFileSync(filePath, 'utf8')
  const title = extractTitle(content)
  const body = formatForQiita(content, article.slug)

  console.log(`   タイトル: ${title}`)
  console.log(`   タグ: ${article.tags.join(', ')}`)

  const result = await postToQiita(title, body, article.tags)

  console.log(`\n✅ Qiita投稿完了!`)
  console.log(`   URL: ${result.url}`)
  console.log(`   タイトル: ${result.title}`)

  // 状態を次の記事に進める
  state.nextIndex = (state.nextIndex + 1) % ARTICLE_FILES.length
  if (!state.postedSlugs) state.postedSlugs = []
  state.postedSlugs.push({ slug: article.slug, url: result.url, postedAt: new Date().toISOString() })
  saveState(state)

  // GitHub Actions サマリー
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('fs')
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## 📝 Qiita投稿完了\n- タイトル: ${result.title}\n- URL: ${result.url}\n- 次回: ${ARTICLE_FILES[(state.nextIndex) % ARTICLE_FILES.length].slug}\n`
    )
  }
}

main().catch(err => {
  // レート制限や重複投稿はワークフロー失敗にしない
  if (err.message?.includes('422') || err.message?.includes('already')) {
    console.warn('⚠️ 投稿をスキップ（重複または制限）:', err.message)
    process.exit(0)
  }
  console.error('❌ エラー:', err.message)
  process.exit(1)
})
