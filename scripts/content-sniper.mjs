#!/usr/bin/env node
/**
 * コンテンツ・スナイパー戦略 自動実行スクリプト
 *
 * 月1回ボタンを押すだけで以下を全自動実行:
 * 1. Search Console分析（順位変動・お宝キーワード・高CTRページ）
 * 2. 低順位記事のリライト（具体例・最新判例を補強）
 * 3. ニッチキーワードの新規記事生成（3000字以上×2本）
 * 4. 全記事への内部リンク自動追加
 * 5. 分析レポートをGitHubにコミット
 */

import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { Octokit } from '@octokit/rest'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? 'tukki-koh/freelance-articles').split('/')

const SITE_URL = 'https://freelance-articles.vercel.app/'
const SAAS_URL = 'https://freelance-contract-checker.vercel.app'

// ================================================================
// Search Console 認証：サービスアカウント（無期限）優先／OAuthフォールバック
// ================================================================
function createSearchConsoleClient() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64
  if (b64) {
    const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
    const jwt = new google.auth.JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    })
    return google.searchconsole({ version: 'v1', auth: jwt })
  }
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  )
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN })
  return google.searchconsole({ version: 'v1', auth: oauth2Client })
}

// ================================================================
// 既存記事の読み込み
// ================================================================
function loadAllArticles() {
  const files = readdirSync(ROOT).filter(f => /^\d+_[\w-]+\.md$/.test(f)).sort()
  return files.map(file => {
    const content = readFileSync(join(ROOT, file), 'utf8')
    const titleMatch = content.match(/^#\s+(.+)$/m)
    const slug = file.replace(/^\d+_/, '').replace(/\.md$/, '')
    const url = `${SITE_URL}articles/${slug}`
    return { file, slug, url, title: titleMatch?.[1] ?? slug, content }
  })
}

function getNextFileNumber(articles) {
  const numbers = articles.map(a => parseInt(a.file.match(/^(\d+)/)?.[1] ?? '0'))
  return Math.max(...numbers, 0) + 1
}

// ================================================================
// 1. Search Console データ取得（90日分）
// ================================================================
async function fetchSearchConsoleData(sc) {
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 90)

  const fmt = d => d.toISOString().split('T')[0]

  // ページ別パフォーマンス
  const pageRes = await sc.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ['page'],
      rowLimit: 100,
    },
  })

  // クエリ別パフォーマンス
  const queryRes = await sc.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ['query'],
      rowLimit: 200,
    },
  })

  // 前月比較（直近30日 vs 前30日）
  const recentStart = new Date()
  recentStart.setDate(recentStart.getDate() - 30)
  const prevEnd = new Date(recentStart)
  prevEnd.setDate(prevEnd.getDate() - 1)
  const prevStart = new Date(prevEnd)
  prevStart.setDate(prevStart.getDate() - 30)

  const recentRes = await sc.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: fmt(recentStart),
      endDate: fmt(endDate),
      dimensions: ['page'],
      rowLimit: 100,
    },
  })

  const prevRes = await sc.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: fmt(prevStart),
      endDate: fmt(prevEnd),
      dimensions: ['page'],
      rowLimit: 100,
    },
  })

  return {
    pages: pageRes.data.rows ?? [],
    queries: queryRes.data.rows ?? [],
    recentPages: recentRes.data.rows ?? [],
    prevPages: prevRes.data.rows ?? [],
  }
}

// ================================================================
// 2. 分析：順位が落ちた記事を特定
// ================================================================
function analyzeRankDrops(recentPages, prevPages) {
  const prevMap = {}
  prevPages.forEach(row => {
    prevMap[row.keys[0]] = row.position
  })

  const drops = []
  recentPages.forEach(row => {
    const url = row.keys[0]
    const currentPos = row.position
    const prevPos = prevMap[url]

    if (prevPos && currentPos > prevPos + 3) {
      drops.push({
        url,
        currentPos: Math.round(currentPos * 10) / 10,
        prevPos: Math.round(prevPos * 10) / 10,
        drop: Math.round((currentPos - prevPos) * 10) / 10,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: Math.round(row.ctr * 1000) / 10,
      })
    }
  })

  return drops.sort((a, b) => b.drop - a.drop)
}

// ================================================================
// 3. 分析：お宝キーワード（記事化されていないニッチ検索）
// ================================================================
function findTreasureKeywords(queries, articles) {
  const existingContent = articles.map(a => a.content.toLowerCase()).join(' ')

  return queries
    .filter(row => {
      const query = row.keys[0]
      const pos = row.position
      const impressions = row.impressions

      // 条件：10回以上表示、20位以下、まだ記事にしていないキーワード
      if (impressions < 10 || pos < 20) return false

      // 既存記事に含まれていないキーワード
      const words = query.split(/\s+/)
      const covered = words.some(w => w.length > 3 && existingContent.includes(w))
      return !covered
    })
    .map(row => ({
      query: row.keys[0],
      impressions: row.impressions,
      clicks: row.clicks,
      position: Math.round(row.position * 10) / 10,
      ctr: Math.round(row.ctr * 1000) / 10,
    }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20)
}

// ================================================================
// 4. 分析：高CTR・改善余地ページ
// ================================================================
function findHighCTRPages(pages, articles) {
  // CTRがポジション平均より高いページを特定
  // ポジション別期待CTR: 1位=28%, 2位=15%, 3位=11%, 4-10位=5%, 11-20位=1.5%
  const expectedCTR = pos => {
    if (pos <= 1) return 0.28
    if (pos <= 2) return 0.15
    if (pos <= 3) return 0.11
    if (pos <= 10) return 0.05
    return 0.015
  }

  return pages
    .filter(row => row.impressions > 50)
    .map(row => {
      const expected = expectedCTR(row.position)
      const ctrRatio = row.ctr / expected
      const article = articles.find(a => row.keys[0].includes(a.slug))
      const hasCTA = article?.content.includes('freelance-contract-checker') ?? false

      return {
        url: row.keys[0],
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: Math.round(row.ctr * 1000) / 10,
        position: Math.round(row.position * 10) / 10,
        ctrRatio: Math.round(ctrRatio * 100) / 100,
        hasCTA,
        needsCTAImprovement: ctrRatio > 1.2 && !hasCTA,
      }
    })
    .filter(p => p.ctrRatio > 1.0)
    .sort((a, b) => b.ctrRatio - a.ctrRatio)
    .slice(0, 10)
}

// ================================================================
// 5. 低順位記事のリライト（具体例・最新判例を補強）
// ================================================================
async function rewriteArticle(article, dropData) {
  console.log(`  📝 リライト: ${article.slug} (${dropData.prevPos}位 → ${dropData.currentPos}位)`)

  const prompt = `以下の記事が検索順位を落としました（${dropData.prevPos}位 → ${dropData.currentPos}位）。

【記事タイトル】
${article.title}

【現在の記事内容】
${article.content}

【リライト指示】
以下の観点で記事を大幅に強化してください：

1. **専門家の語尾に統一**
   - 「〜かもしれません」→「〜と定められています（フリーランス新法第〇条）」
   - 曖昧な表現は全て条文番号付きの断定表現に変える

2. **具体例を3つ以上追加**
   - 実際に起こりうる契約書の文例（NG例とOK例を対比）
   - 数字や金額を含む具体的なシナリオ

3. **2025〜2026年の最新状況を反映**
   - フリーランス新法施行後の実務上の変化
   - 行政指導・企業名公表事例への言及（一般的な傾向として）

4. **CTAを強化**
   - 結論直下に必ず追加: > **[→ 契約書を500円でAI診断する](${SAAS_URL}/pricing)**
   - 記事中盤にも1箇所追加

5. **文字数を現在の1.5倍以上に増やす**

6. **冒頭を感情的共感から始める**
   - ユーザーが「自分のことだ」と感じる具体的な状況描写

品質基準：
- 断定的な専門家語尾（条文番号必須）
- ニッチな悩みに具体的に答える
- 最後は「今すぐできること1つ」で締める
- テーブルは最大3列

完全な記事をMarkdown形式で出力してください。`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    messages: [{ role: 'user', content: prompt }],
  })

  return message.content[0].text
}

// ================================================================
// 6. ニッチキーワードで新規記事生成（3000字以上）
// ================================================================
async function createNicheArticle(keyword, impressions) {
  console.log(`  ✨ 新規記事生成: 「${keyword}」(${impressions}回表示)`)

  const prompt = `以下のキーワードで検索しているユーザーのために、3000文字以上の深い解説記事を書いてください。

【ターゲットキーワード】
${keyword}

【品質基準】
1. **冒頭（感情的共感）**
   - ユーザーが「まさに自分の状況だ」と感じる具体的な描写から始める
   - 「この記事を読めば〇〇がわかる」と明示する

2. **結論を早く出す**
   - h1の下、最初のh2の後に結論を出す
   - 結論の直下に必ずCTAを追加:
     > **[→ 契約書を500円でAI診断する（条文番号付きで違反箇所を特定）](${SAAS_URL}/pricing)**

3. **専門家の語尾（必須）**
   - 「〜と定められています（フリーランス新法第〇条）」
   - 「〜は違法です（根拠：〇〇法第〇条）」
   - 「〜する義務があります（第〇条）」
   - 「〜かもしれません」「〜可能性があります」は使わない

4. **具体例を豊富に**
   - 実際の契約書文例（NG vs OK の対比）
   - 数字・金額・日数を含む具体的シナリオ
   - 「実際にこういうケースがある」という描写

5. **構成（h2を5〜7個）**
   - 問題提起（ユーザーの状況）
   - 法律の規定（条文番号付き）
   - 具体的なリスク（過料・行政指導・損害賠償）
   - NG文例とOK文例の対比
   - 中盤CTA
   - 対処法・交渉術
   - 今すぐできること（末尾CTA）

6. **テーブルは最大3列**

7. **文字数：3000字以上（必須）**

8. **末尾のCTA**
   > **[→ 今すぐ契約書を診断して問題を解決する（500円・30秒）](${SAAS_URL}/pricing)**

メタディスクリプション（120文字以内）も冒頭に入れてください：
**メタディスクリプション：** （内容）

完全な記事をMarkdown形式で出力してください。`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    messages: [{ role: 'user', content: prompt }],
  })

  return message.content[0].text
}

// ================================================================
// 7. 内部リンクを全記事に自動追加
// ================================================================
async function addInternalLinks(articles) {
  console.log('  🔗 内部リンク追加中...')

  // 記事間の関連性マップを構築
  const keywordMap = articles.map(a => {
    const keywords = []
    const titleWords = a.title.split(/[｜・\s　]+/).filter(w => w.length > 2)
    keywords.push(...titleWords)

    // 法律キーワードを抽出
    const lawKeywords = ['フリーランス新法', '下請法', '支払期日', '中途解除',
      '報酬', '書面交付', '禁止行為', '修正', '著作権', '秘密保持']
    lawKeywords.forEach(kw => {
      if (a.content.includes(kw)) keywords.push(kw)
    })

    return { ...a, keywords: [...new Set(keywords)] }
  })

  const updatedArticles = []

  for (const article of keywordMap) {
    // 関連記事を見つける（自分以外で2つ以上のキーワードが一致）
    const related = keywordMap
      .filter(other => other.slug !== article.slug)
      .map(other => {
        const commonKeywords = article.keywords.filter(kw =>
          other.keywords.includes(kw) || other.title.includes(kw) || other.content.includes(kw)
        )
        return { ...other, score: commonKeywords.length }
      })
      .filter(r => r.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    if (related.length === 0) continue

    // 既に関連記事セクションがあればスキップ
    if (article.content.includes('## 関連記事')) continue

    // 関連記事セクションを追記
    const relatedSection = `\n---\n\n## 関連記事\n\n${related.map(r =>
      `- [${r.title}](${SITE_URL}articles/${r.slug})`
    ).join('\n')}\n`

    // 免責事項の前に挿入
    const updatedContent = article.content.includes('*本記事の情報は')
      ? article.content.replace('*本記事の情報は', `${relatedSection}\n*本記事の情報は`)
      : article.content + relatedSection

    if (updatedContent !== article.content) {
      updatedArticles.push({ ...article, updatedContent })
    }
  }

  console.log(`  ✅ ${updatedArticles.length}記事に内部リンクを追加`)
  return updatedArticles
}

// ================================================================
// 8. GitHubにコミット
// ================================================================
async function commitToGitHub(filePath, content, message) {
  const encodedContent = Buffer.from(content).toString('base64')

  const existing = await octokit.repos.getContent({ owner, repo, path: filePath })
    .then(r => r.data).catch(() => null)

  await octokit.repos.createOrUpdateFileContents({
    owner, repo,
    path: filePath,
    message,
    content: encodedContent,
    sha: existing?.sha,
  })
  console.log(`  ✅ コミット: ${filePath}`)
}

// ================================================================
// 9. 分析レポート生成
// ================================================================
function generateReport({ drops, treasureKeywords, highCTRPages, rewrittenCount, newArticleCount, internalLinkCount, date }) {
  return `# コンテンツ・スナイパー 月次レポート
実行日時: ${date}

---

## 📉 順位が落ちた記事（リライト実施）

${drops.length === 0 ? '順位低下なし' : drops.slice(0, 5).map(d => `
### ${d.url}
- 前月順位: **${d.prevPos}位** → 今月: **${d.currentPos}位**（-${d.drop}位）
- クリック数: ${d.clicks} / 表示回数: ${d.impressions} / CTR: ${d.ctr}%
- ステータス: ${d.drop > 5 ? '🔴 リライト実施済み' : '🟡 要監視'}
`).join('')}

---

## 💎 お宝キーワード（新規記事化の優先候補）

| キーワード | 表示回数 | 順位 | CTR |
|-----------|---------|------|-----|
${treasureKeywords.slice(0, 10).map(k =>
  `| ${k.query} | ${k.impressions} | ${k.position}位 | ${k.ctr}% |`
).join('\n')}

---

## 🎯 高CTRページ（購入導線の改善余地）

| ページ | CTR | 期待比 | CTA有無 | 推奨対応 |
|-------|-----|--------|--------|---------|
${highCTRPages.slice(0, 5).map(p =>
  `| ${p.url.replace(SITE_URL, '/')} | ${p.ctr}% | ${p.ctrRatio}倍 | ${p.hasCTA ? '✅' : '❌'} | ${p.needsCTAImprovement ? '🔴 CTAを早期追加' : p.hasCTA ? '✅ 良好' : '🟡 CTA追加推奨'} |`
).join('\n')}

---

## 📊 今月の実施サマリー

| 項目 | 件数 |
|-----|------|
| リライト実施記事 | ${rewrittenCount}記事 |
| 新規記事生成 | ${newArticleCount}記事 |
| 内部リンク追加 | ${internalLinkCount}記事 |

---

## 🎯 来月の推奨アクション

${treasureKeywords.slice(0, 3).map((k, i) =>
  `${i + 1}. 「${k.query}」で新規記事を作成（${k.impressions}回表示・${k.position}位）`
).join('\n')}

---
*自動生成レポート by コンテンツ・スナイパー*
`
}

// ================================================================
// メイン処理
// ================================================================
async function main() {
  console.log('🎯 コンテンツ・スナイパー 起動\n')

  const date = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
  const articles = loadAllArticles()
  console.log(`📚 既存記事: ${articles.length}本\n`)

  // --- Search Console データ取得 ---
  console.log('📊 Search Consoleデータ取得中...')
  const sc = createSearchConsoleClient()
  const { pages, queries, recentPages, prevPages } = await fetchSearchConsoleData(sc)
  console.log(`  → ページ: ${pages.length}件 / クエリ: ${queries.length}件\n`)

  // --- 分析 ---
  console.log('🔍 分析中...')
  const drops = analyzeRankDrops(recentPages, prevPages)
  const treasureKeywords = findTreasureKeywords(queries, articles)
  const highCTRPages = findHighCTRPages(pages, articles)

  console.log(`  → 順位低下: ${drops.length}記事`)
  console.log(`  → お宝キーワード: ${treasureKeywords.length}件`)
  console.log(`  → 高CTRページ: ${highCTRPages.length}件\n`)

  let rewrittenCount = 0
  let newArticleCount = 0

  // --- リライト（順位5位以上下落した記事） ---
  console.log('📝 リライト実施...')
  const rewriteTargets = drops.filter(d => d.drop >= 5).slice(0, 2)

  for (const dropData of rewriteTargets) {
    const article = articles.find(a => dropData.url.includes(a.slug))
    if (!article) continue

    const rewritten = await rewriteArticle(article, dropData)
    await commitToGitHub(
      article.file,
      rewritten,
      `fix: 順位低下リライト「${article.title}」(${dropData.prevPos}→${dropData.currentPos}位)`
    )
    rewrittenCount++
  }

  // --- 新規記事生成（お宝キーワード上位2件） ---
  console.log('\n✨ 新規記事生成...')
  const newTargets = treasureKeywords.slice(0, 2)
  const nextNum = getNextFileNumber(articles)

  for (let i = 0; i < newTargets.length; i++) {
    const keyword = newTargets[i]
    const articleContent = await createNicheArticle(keyword.query, keyword.impressions)

    // タイトル抽出してslug生成
    const titleMatch = articleContent.match(/^#\s+(.+)$/m)
    const title = titleMatch?.[1] ?? keyword.query
    const slug = keyword.query
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 50)

    const fileNum = String(nextNum + i).padStart(2, '0')
    const filename = `${fileNum}_${slug}.md`

    await commitToGitHub(filename, articleContent, `feat: 新規記事「${title}」`)
    newArticleCount++
    console.log(`  → 作成: ${filename}`)
  }

  // --- 内部リンク追加 ---
  console.log('\n🔗 内部リンク追加...')
  const updatedArticles = await addInternalLinks(articles)

  for (const article of updatedArticles) {
    await commitToGitHub(
      article.file,
      article.updatedContent,
      `chore: 内部リンク追加「${article.title}」`
    )
  }

  // --- レポート生成・コミット ---
  console.log('\n📋 レポート生成...')
  const report = generateReport({
    drops, treasureKeywords, highCTRPages,
    rewrittenCount, newArticleCount,
    internalLinkCount: updatedArticles.length,
    date,
  })

  const reportFilename = `reports/sniper-${new Date().toISOString().slice(0, 7)}.md`
  await commitToGitHub(reportFilename, report, `docs: ${date} コンテンツ・スナイパーレポート`)

  console.log('\n✅ 全処理完了!')
  console.log(`  リライト: ${rewrittenCount}記事`)
  console.log(`  新規記事: ${newArticleCount}記事`)
  console.log(`  内部リンク: ${updatedArticles.length}記事`)
  console.log(`  レポート: ${reportFilename}`)
}

main().catch(err => {
  console.error('❌ エラー:', err)
  process.exit(1)
})
