#!/usr/bin/env node
/**
 * フリーランス新法ニュース自動監視 → Claude下書き生成 → GitHub PR作成
 *
 * 動作：
 * 1. 複数のRSSフィードから法改正・関連ニュースを取得
 * 2. 直近7日以内の新着を抽出
 * 3. Claude APIで1500字のSEO記事下書きを生成
 * 4. GitHubにPRを作成（スマホでマージ→Vercel自動デプロイ）
 */

import Anthropic from '@anthropic-ai/sdk'
import Parser from 'rss-parser'
import { Octokit } from '@octokit/rest'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ================================================================
// RSS フィード一覧（厚労省・公取委・e-Gov・Google News）
// ================================================================
const RSS_FEEDS = [
  {
    name: '厚生労働省 新着情報',
    url: 'https://www.mhlw.go.jp/stf/news/index.html',
    rss: 'https://www.mhlw.go.jp/rss/new.rdf',
  },
  {
    name: '公正取引委員会 新着情報',
    url: 'https://www.jftc.go.jp/',
    rss: 'https://www.jftc.go.jp/rss/index.xml',
  },
  {
    name: 'Google News - フリーランス新法',
    url: 'https://news.google.com/',
    rss: 'https://news.google.com/rss/search?q=%E3%83%95%E3%83%AA%E3%83%BC%E3%83%A9%E3%83%B3%E3%82%B9+%E6%96%B0%E6%B3%95&hl=ja&gl=JP&ceid=JP:ja',
  },
  {
    name: 'Google News - 業務委託 法律',
    url: 'https://news.google.com/',
    rss: 'https://news.google.com/rss/search?q=%E6%A5%AD%E5%8B%99%E5%A7%94%E8%A8%97+%E6%B3%95%E5%BE%8B+%E6%94%B9%E6%AD%A3&hl=ja&gl=JP&ceid=JP:ja',
  },
  {
    name: 'Google News - 下請法',
    url: 'https://news.google.com/',
    rss: 'https://news.google.com/rss/search?q=%E4%B8%8B%E8%AB%8B%E6%B3%95+%E6%94%B9%E6%AD%A3&hl=ja&gl=JP&ceid=JP:ja',
  },
]

const KEYWORDS = [
  'フリーランス', '特定受託事業者', '業務委託', '下請法', '下請代金',
  '買いたたき', '支払遅延', '支払い遅延', '報酬', '中途解除',
  '返品禁止', 'ハラスメント', 'フリーランス保護', '法改正',
]

// ================================================================
// ユーティリティ
// ================================================================
function loadSeenItems() {
  const path = join(ROOT, 'scripts', '.seen-items.json')
  if (existsSync(path)) {
    return new Set(JSON.parse(readFileSync(path, 'utf8')))
  }
  return new Set()
}

function saveSeenItems(seen) {
  const path = join(ROOT, 'scripts', '.seen-items.json')
  writeFileSync(path, JSON.stringify([...seen]))
}

function isRecent(dateStr) {
  if (!dateStr) return false
  const date = new Date(dateStr)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  return date > weekAgo
}

function isRelevant(item) {
  const text = `${item.title ?? ''} ${item.contentSnippet ?? ''}`.toLowerCase()
  return KEYWORDS.some(kw => text.includes(kw.toLowerCase()))
}

function toSlug(title) {
  const date = new Date().toISOString().slice(0, 10)
  const short = title
    .replace(/[^぀-ヿ一-鿿㐀-䶿a-zA-Z0-9]/g, '-')
    .slice(0, 40)
  return `news-${date}-${short}`.toLowerCase().replace(/-+/g, '-')
}

// ================================================================
// Step 1: RSSフィードを取得して新着を抽出
// ================================================================
async function fetchNewItems() {
  const parser = new Parser({ timeout: 10000 })
  const seen = loadSeenItems()
  const newItems = []

  for (const feed of RSS_FEEDS) {
    try {
      console.log(`📡 Fetching: ${feed.name}`)
      const result = await parser.parseURL(feed.rss)
      for (const item of result.items ?? []) {
        const id = item.guid ?? item.link ?? item.title
        if (!id || seen.has(id)) continue
        if (!isRecent(item.pubDate ?? item.isoDate)) continue
        if (!isRelevant(item)) continue
        newItems.push({ ...item, sourceName: feed.name, id })
      }
    } catch (e) {
      console.warn(`⚠️ Failed to fetch ${feed.name}: ${e.message}`)
    }
  }

  console.log(`✅ Found ${newItems.length} new relevant items`)
  return { newItems, seen }
}

// ================================================================
// Step 2: Claude APIで記事下書きを生成
// ================================================================
async function generateDraft(items) {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const newsText = items
    .slice(0, 5)
    .map(i => `・${i.title}\n  出典: ${i.sourceName}\n  URL: ${i.link ?? ''}`)
    .join('\n\n')

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `あなたはフリーランス新法・下請法の専門ライターです。
以下の最新ニュース・法改正情報をもとに、フリーランスと中小企業の発注担当者向けSEO記事の下書きを作成してください。

【最新ニュース】
${newsText}

【記事要件】
- 文字数：1200〜1600字
- 構成：見出し（H1・H2・H3）付きのMarkdown
- 冒頭にメタディスクリプション（**メタディスクリプション：** で始める）
- フリーランス新法・下請法の条文番号を根拠として引用
- 読者が「へえ、知らなかった！」と思える具体的な事例を含める
- 末尾にCTA：「契約書のリスクをAIでチェック → https://freelance-contract-checker.vercel.app」
- ハルシネーション防止：不確かな情報は「要確認」と明記

記事タイトル（H1）と本文のみ出力してください。前置き不要。`,
      },
    ],
  })

  return message.content[0].text
}

// ================================================================
// Step 3: GitHubにPRを作成
// ================================================================
async function createPullRequest(slug, content, items) {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? 'owner/repo').split('/')

  const fileName = `${slug}.md`
  const filePath = fileName
  const branch = `draft/${slug}`
  const title = items[0]?.title ?? '新着ニュース下書き'

  // mainブランチのSHAを取得
  const { data: ref } = await octokit.git.getRef({
    owner, repo, ref: 'heads/main',
  })

  // 新しいブランチを作成
  await octokit.git.createRef({
    owner, repo,
    ref: `refs/heads/${branch}`,
    sha: ref.object.sha,
  })

  // ファイルをコミット
  await octokit.repos.createOrUpdateFileContents({
    owner, repo, branch,
    path: filePath,
    message: `draft: ${title}`,
    content: Buffer.from(content).toString('base64'),
  })

  // PRを作成
  const { data: pr } = await octokit.pulls.create({
    owner, repo,
    title: `📝 下書き: ${title}`,
    body: `## 自動生成された記事下書き\n\n**ソースニュース:**\n${items.map(i => `- [${i.title}](${i.link})`).join('\n')}\n\n---\n\n✅ マージするとVercelに自動デプロイされます\n❌ 不要な場合はそのままクローズしてください`,
    head: branch,
    base: 'main',
  })

  return pr.html_url
}

// ================================================================
// メイン処理
// ================================================================
async function main() {
  console.log('🔍 フリーランス新法ニュース監視スクリプト開始')

  const { newItems, seen } = await fetchNewItems()

  if (newItems.length === 0) {
    console.log('📭 新着ニュースなし。今週はスキップ。')
    return
  }

  console.log('✍️ Claude APIで記事下書きを生成中...')
  const draft = await generateDraft(newItems)

  const slug = toSlug(newItems[0].title)

  if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
    console.log('🚀 GitHubにPRを作成中...')
    const prUrl = await createPullRequest(slug, draft, newItems)
    console.log(`✅ PR作成完了: ${prUrl}`)
  } else {
    // ローカル実行時はファイルに保存
    const outputPath = join(ROOT, `${slug}.draft.md`)
    writeFileSync(outputPath, draft)
    console.log(`💾 下書きを保存: ${outputPath}`)
  }

  // 処理済みアイテムを記録
  newItems.forEach(item => seen.add(item.id))
  saveSeenItems(seen)

  console.log('🎉 完了！')
}

main().catch(err => {
  console.error('❌ エラー:', err)
  process.exit(1)
})
