#!/usr/bin/env node
/**
 * フリーランス新法ニュース自動監視 → Claude下書き生成 → 公開 → X投稿
 *
 * 動作：
 * 1. RSSフィードから法改正・関連ニュースを取得
 * 2. 直近7日以内の新着を抽出
 * 3. Claude APIで1500字のSEO記事を生成
 * 4. mainブランチに直接コミット（Vercel自動デプロイ）
 * 5. X（Twitter）に自動投稿
 */

import Anthropic from '@anthropic-ai/sdk'
import Parser from 'rss-parser'
import { Octokit } from '@octokit/rest'
import { TwitterApi } from 'twitter-api-v2'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ================================================================
// RSS フィード一覧
// ================================================================
const RSS_FEEDS = [
  {
    name: '厚生労働省',
    rss: 'https://www.mhlw.go.jp/rss/new.rdf',
  },
  {
    name: '公正取引委員会',
    rss: 'https://www.jftc.go.jp/rss/index.xml',
  },
  {
    name: 'Google News - フリーランス新法',
    rss: 'https://news.google.com/rss/search?q=%E3%83%95%E3%83%AA%E3%83%BC%E3%83%A9%E3%83%B3%E3%82%B9+%E6%96%B0%E6%B3%95&hl=ja&gl=JP&ceid=JP:ja',
  },
  {
    name: 'Google News - 業務委託 法律',
    rss: 'https://news.google.com/rss/search?q=%E6%A5%AD%E5%8B%99%E5%A7%94%E8%A8%97+%E6%B3%95%E5%BE%8B+%E6%94%B9%E6%AD%A3&hl=ja&gl=JP&ceid=JP:ja',
  },
  {
    name: 'Google News - 下請法',
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
  if (existsSync(path)) return new Set(JSON.parse(readFileSync(path, 'utf8')))
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
  const short = title.replace(/[^\w]/g, '-').slice(0, 30)
  return `news-${date}-${short}`.toLowerCase().replace(/-+/g, '-').replace(/-$/, '')
}

// ================================================================
// Step 1: RSSフィードから新着を取得
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
      console.warn(`⚠️ Failed: ${feed.name}: ${e.message}`)
    }
  }

  console.log(`✅ ${newItems.length}件の新着ニュースを発見`)
  return { newItems, seen }
}

// ================================================================
// Step 2: Claude APIで記事を生成
// ================================================================
async function generateArticle(items) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const newsText = items
    .slice(0, 5)
    .map(i => `・${i.title}\n  出典: ${i.sourceName}\n  URL: ${i.link ?? ''}`)
    .join('\n\n')

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `あなたはフリーランス新法・下請法の専門ライターです。
以下の最新ニュース・法改正情報をもとに、フリーランスと中小企業の発注担当者向けSEO記事を作成してください。

【最新ニュース】
${newsText}

【記事要件】
- 文字数：1200〜1600字
- 構成：見出し（H1・H2・H3）付きのMarkdown
- 1行目：# タイトル（SEOを意識した具体的なタイトル）
- 2行目：空行
- 3行目：**メタディスクリプション：** 〜（120字以内）
- フリーランス新法・下請法の条文番号を根拠として引用
- 読者が「知らなかった！」と思える具体的な事例を含める
- 不確かな情報は「要確認」と明記
- 末尾のCTA（変更不可）：
  > **👉 契約書のリスクをAIでチェック → https://freelance-contract-checker.vercel.app**

記事本文のみ出力。前置き不要。`,
    }],
  })

  const content = message.content[0].text

  // タイトルとメタディスクリプションを抽出（X投稿用）
  const titleMatch = content.match(/^#\s+(.+)$/m)
  const descMatch = content.match(/\*\*メタディスクリプション：\*\*\s*(.+)/)
  const title = titleMatch?.[1] ?? items[0]?.title ?? '新着情報'
  const description = descMatch?.[1] ?? ''

  return { content, title, description }
}

// ================================================================
// Step 3: GitHubのmainブランチに直接コミット（Vercel自動デプロイ）
// ================================================================
async function publishArticle(slug, content) {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/')

  // lib/articles.ts のSLUG一覧に追加
  const articlesPath = 'lib/articles.ts'
  const { data: articlesFile } = await octokit.repos.getContent({ owner, repo, path: articlesPath })
  const currentContent = Buffer.from(articlesFile.content, 'base64').toString('utf8')

  const newEntry = `  { slug: '${slug}', file: '${slug}.md' },`
  const updatedContent = currentContent.replace(
    /(\] *\/\/ END_ARTICLES|const ARTICLE_FILES = \[)/,
    (match) => match.includes('END') ? match : match
  ).replace(
    /(const ARTICLE_FILES[^=]*=\s*\[)([\s\S]*?)(\])/,
    (_, open, items, close) => `${open}${items}${newEntry}\n${close}`
  )

  // 既存ファイルのSHAを取得（更新時に必要）
  let existingSha
  try {
    const { data: existing } = await octokit.repos.getContent({ owner, repo, path: `${slug}.md` })
    existingSha = existing.sha
  } catch {
    // ファイルが存在しない場合はそのまま新規作成
  }

  // 記事ファイルをコミット
  await octokit.repos.createOrUpdateFileContents({
    owner, repo,
    path: `${slug}.md`,
    message: `feat: 新着記事「${slug}」を自動公開`,
    content: Buffer.from(content).toString('base64'),
    branch: 'main',
    ...(existingSha ? { sha: existingSha } : {}),
  })

  console.log(`✅ 記事を公開: ${slug}.md`)
  return `https://freelance-articles.vercel.app/articles/${slug}`
}

// ================================================================
// Step 4: X（Twitter）に自動投稿
// ================================================================
async function postToX(title, description, articleUrl) {
  // 認証情報の確認（先頭5文字のみ表示）
  console.log('X_API_KEY:', process.env.X_API_KEY?.slice(0, 5))
  console.log('X_ACCESS_TOKEN:', process.env.X_ACCESS_TOKEN?.slice(0, 5))

  const client = new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  })

  // 140字以内に収める
  const text = `【フリーランス新法】${title}\n\n${description.slice(0, 80)}...\n\n詳しくはこちら👇\n${articleUrl}`

  try {
    const { data } = await client.v2.tweet(text)
    console.log(`✅ X投稿完了: https://x.com/i/web/status/${data.id}`)
    return data.id
  } catch (err) {
    console.error('X APIエラー詳細:', JSON.stringify(err?.data ?? err?.message ?? err, null, 2))
    throw err
  }
}

// ================================================================
// メイン処理
// ================================================================
async function main() {
  console.log('🔍 フリーランス新法ニュース監視スクリプト開始\n')

  const { newItems, seen } = await fetchNewItems()

  if (newItems.length === 0) {
    console.log('📭 新着ニュースなし。今週はスキップ。')
    return
  }

  console.log('\n✍️ Claude APIで記事を生成中...')
  const { content, title, description } = await generateArticle(newItems)

  const slug = toSlug(newItems[0].title ?? title)

  if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
    console.log('\n🚀 Vercelに自動公開中...')
    const articleUrl = await publishArticle(slug, content)

    console.log('\n🐦 Xに投稿中...')
    await postToX(title, description, articleUrl)

    console.log(`\n🎉 完了！\n記事URL: ${articleUrl}`)
  } else {
    // ローカルテスト時
    const outputPath = join(ROOT, `${slug}.draft.md`)
    writeFileSync(outputPath, content)
    console.log(`\n💾 ローカル保存: ${outputPath}`)
    console.log(`タイトル: ${title}`)
  }

  newItems.forEach(item => seen.add(item.id))
  saveSeenItems(seen)
}

main().catch(err => {
  console.error('❌ エラー:', err.message)
  process.exit(1)
})
