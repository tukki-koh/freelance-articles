#!/usr/bin/env node
/**
 * クオリティ基準準拠 記事自動生成スクリプト
 *
 * 品質基準:
 * - 感情的共感から始まる冒頭（ユーザーの状況を描写）
 * - 結論直下に500円診断CTAを設置
 * - 断定的な専門家語尾（条文番号付き）
 * - 記事中盤にも追加CTA
 * - 「今すぐできること」で締める
 */

import Anthropic from '@anthropic-ai/sdk'
import { Octokit } from '@octokit/rest'
import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? 'tukki-koh/freelance-articles').split('/')

// ================================================================
// 記事テーマプール（5クラスター × 複数テーマ）
// 既存記事と重複しないよう管理
// ================================================================
const ARTICLE_THEMES = [
  // クラスター①：自分に関係あるか不安
  {
    cluster: 'applicable',
    title: '個人事業主とフリーランスの違い｜フリーランス新法の適用はどちらか',
    keywords: ['個人事業主', 'フリーランス', '新法', '適用'],
  },
  {
    cluster: 'applicable',
    title: '副業フリーランスにもフリーランス新法は適用される？会社員×副業の法律解説',
    keywords: ['副業', 'フリーランス新法', '会社員', '適用'],
  },
  {
    cluster: 'applicable',
    title: '一人法人（マイクロ法人）へのフリーランス新法の適用範囲を徹底解説',
    keywords: ['一人法人', 'マイクロ法人', 'フリーランス新法'],
  },
  // クラスター②：契約書の条項が怖い
  {
    cluster: 'contract',
    title: '「秘密保持契約（NDA）」でフリーランスが注意すべき5つの危険条項',
    keywords: ['秘密保持契約', 'NDA', 'フリーランス', '危険条項'],
  },
  {
    cluster: 'contract',
    title: '業務委託契約書の「検収条項」完全解説｜不利な文言と安全な修正案',
    keywords: ['検収', '業務委託契約', '条項', 'フリーランス'],
  },
  {
    cluster: 'contract',
    title: 'フリーランスの「競業避止義務」条項は有効か？法的判断基準と対処法',
    keywords: ['競業避止義務', 'フリーランス', '契約書'],
  },
  // クラスター③：お金のトラブル
  {
    cluster: 'payment',
    title: '業務委託の「報酬減額」は違法？フリーランス新法・下請法での対処法',
    keywords: ['報酬減額', '業務委託', 'フリーランス新法', '下請法'],
  },
  {
    cluster: 'payment',
    title: 'フリーランスが「検収拒否」された場合の対処法｜法的根拠と請求手順',
    keywords: ['検収拒否', 'フリーランス', '対処法'],
  },
  {
    cluster: 'payment',
    title: '遅延損害金の計算方法と請求手順｜フリーランスが知るべき年14.6%の下請法ルール',
    keywords: ['遅延損害金', '下請法', 'フリーランス', '年14.6%'],
  },
  // クラスター④：発注側の不安
  {
    cluster: 'ordering',
    title: 'フリーランスへの発注書の書き方｜フリーランス新法第3条に対応した必須テンプレート',
    keywords: ['発注書', 'フリーランス新法', '書面交付義務', 'テンプレート'],
  },
  {
    cluster: 'ordering',
    title: 'スタートアップのフリーランス活用で気をつけるべき法令違反リスク5選',
    keywords: ['スタートアップ', 'フリーランス', '法令違反', '発注'],
  },
  // クラスター⑤：法律を理解したい
  {
    cluster: 'knowledge',
    title: 'フリーランス新法「第5条禁止行為」全7項目をわかりやすく解説',
    keywords: ['フリーランス新法', '第5条', '禁止行為', '解説'],
  },
  {
    cluster: 'knowledge',
    title: '下請法の「3条書面」とは？必須記載事項と書き方を具体例で解説',
    keywords: ['下請法', '3条書面', '書面交付', '必須記載事項'],
  },
  {
    cluster: 'knowledge',
    title: 'フリーランス新法「第16条」解説｜中途解除・不更新の30日前予告義務とは',
    keywords: ['フリーランス新法', '第16条', '中途解除', '30日前'],
  },
]

// ================================================================
// 既存記事ファイルを取得してテーマの重複チェック
// ================================================================
function getExistingArticles() {
  return readdirSync(ROOT)
    .filter(f => /^\d+_[\w-]+\.md$/.test(f))
    .sort()
}

function getNextFileNumber(existingFiles) {
  const numbers = existingFiles
    .map(f => parseInt(f.match(/^(\d+)_/)?.[1] ?? '0'))
    .filter(n => n > 0)
  return Math.max(...numbers, 0) + 1
}

function selectTheme(existingFiles) {
  const existingTitles = existingFiles.map(f => {
    try {
      const content = readFileSync(join(ROOT, f), 'utf8')
      return content.match(/^#\s+(.+)$/m)?.[1] ?? ''
    } catch { return '' }
  })

  // 既存記事と重複しないテーマを選択
  const available = ARTICLE_THEMES.filter(theme =>
    !existingTitles.some(title =>
      theme.keywords.some(kw => title.includes(kw))
    )
  )

  if (available.length === 0) return ARTICLE_THEMES[0]

  // クラスターをローテーションして偏りをなくす
  const clusterCounts = {}
  existingFiles.slice(-5).forEach(f => {
    const content = readFileSync(join(ROOT, f), 'utf8').slice(0, 200)
    ARTICLE_THEMES.forEach(t => {
      if (t.keywords.some(kw => content.includes(kw))) {
        clusterCounts[t.cluster] = (clusterCounts[t.cluster] ?? 0) + 1
      }
    })
  })

  // 最も使われていないクラスターのテーマを優先
  available.sort((a, b) =>
    (clusterCounts[a.cluster] ?? 0) - (clusterCounts[b.cluster] ?? 0)
  )

  return available[0]
}

// ================================================================
// Claude APIでクオリティ基準準拠の記事を生成
// ================================================================
async function generateArticle(theme) {
  const systemPrompt = `あなたはフリーランス新法・下請法の専門家ライターです。
フリーランスや発注担当者向けに、法律の専門知識を持ちながら読みやすい記事を書きます。

【必須品質基準】
1. 冒頭は必ずユーザーが「自分のことだ」と感じる具体的な状況描写から始める
2. 結論を出した直後（結論の2〜3行下）に必ず以下のCTAを入れる:
   > **[→ 契約書を500円でAI診断する（条文番号付きで違反箇所を特定）](https://freelance-contract-checker.vercel.app/pricing)**
3. 語尾は必ず断定調：「〜と定められています（フリーランス新法第〇条）」「〜は違法です」「〜する義務があります」
   「〜かもしれません」「〜可能性があります」「〜と思います」は絶対に使わない
4. 記事中盤（h2の2〜3個目の後）にも必ずCTAを入れる
5. 末尾は「今すぐできること1つ」で締める（500円診断ツールへのリンク付き）
6. 条文番号は必ず根拠として記載する（例：フリーランス新法第5条第7号）
7. テーブルは最大3列まで（スマホ対応）
8. 文字数：2000〜3000字

【CTAの文言パターン（記事の文脈に合わせて変える）】
- 「→ 契約書を500円でAI診断する」
- 「→ 今の契約書の違反リスクを30秒で確認する」
- 「→ 500円で契約書を守る（専門知識不要）」

【記事の構造】
# タイトル
**メタディスクリプション：** （120文字以内）

---
## 共感の冒頭（ユーザーの状況描写）
## 結論（断定）
> CTA（結論直下）
## 詳細解説（h2×3〜4個、各自に条文番号）
> CTA（中盤）
## 今すぐできること
> CTA（末尾）`

  const userPrompt = `以下のテーマで記事を書いてください。

テーマ：${theme.title}
クラスター：${theme.cluster}
関連キーワード：${theme.keywords.join('、')}

品質基準を全て守り、フリーランス新法・下請法の条文番号を根拠として使いながら、
読者が「自分の問題が解決された」と感じ、かつ診断ツールへの購買意欲が湧く記事を書いてください。`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: userPrompt }],
    system: systemPrompt,
  })

  return message.content[0].text
}

// ================================================================
// ファイル名のslugを生成
// ================================================================
function titleToSlug(title) {
  const clusterMap = {
    applicable: 'applicable',
    contract: 'contract',
    payment: 'payment',
    ordering: 'ordering',
    knowledge: 'knowledge',
  }
  return title
    .replace(/[「」【】？！。、・]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 50)
    .replace(/-+$/, '')
}

// ================================================================
// GitHubにコミット
// ================================================================
async function commitToGitHub(filename, content) {
  const filePath = filename
  const encodedContent = Buffer.from(content).toString('base64')

  try {
    const { data: existing } = await octokit.repos.getContent({
      owner, repo, path: filePath,
    }).catch(() => ({ data: null }))

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: `feat: 新記事を自動生成「${filename}」`,
      content: encodedContent,
      sha: existing?.sha,
    })

    console.log(`✅ GitHubにコミット: ${filePath}`)
  } catch (err) {
    console.error('GitHub commit error:', err.message)
    throw err
  }
}

// ================================================================
// メイン処理
// ================================================================
async function main() {
  console.log('📝 記事生成を開始...')

  const existingFiles = getExistingArticles()
  const nextNumber = getNextFileNumber(existingFiles)
  const theme = selectTheme(existingFiles)

  console.log(`📌 選択テーマ: ${theme.title}`)
  console.log(`📁 記事番号: ${nextNumber}`)

  const articleContent = await generateArticle(theme)

  const slug = titleToSlug(theme.title)
  const filename = `${String(nextNumber).padStart(2, '0')}_${slug}.md`

  // ローカルにも保存（ローカル実行時）
  if (!process.env.GITHUB_TOKEN || process.env.LOCAL_SAVE === 'true') {
    writeFileSync(join(ROOT, filename), articleContent)
    console.log(`💾 ローカル保存: ${filename}`)
  }

  // GitHubにコミット（CI環境またはトークンあり）
  if (process.env.GITHUB_TOKEN) {
    await commitToGitHub(filename, articleContent)
  }

  console.log(`✅ 完了: ${filename}`)
  console.log(`🔗 URL: https://freelance-articles.vercel.app/articles/${slug}`)

  return { filename, slug, theme }
}

main().catch(err => {
  console.error('❌ エラー:', err)
  process.exit(1)
})
