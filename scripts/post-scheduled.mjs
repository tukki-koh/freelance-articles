#!/usr/bin/env node
/**
 * 既存10記事をX（Twitter）に週1本ずつ自動投稿するスクリプト
 * GitHub Actions から毎週水曜 朝9時に実行
 */

import { TwitterApi } from 'twitter-api-v2'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// 投稿キュー（順番に投稿、全て投稿したらループ）
const POST_QUEUE = [
  {
    text: '【フリーランス新法】報酬の支払いは「受領日から60日以内」が法的義務です。「翌々月末払い」は違反になる可能性があります。\n\n契約書に支払期日が明記されているか確認を👇',
    url: 'https://freelance-articles.vercel.app/articles/60day-rule-violation',
  },
  {
    text: '業務委託契約を結ぶ前に確認すべき10項目📋\n\nフリーランス新法・下請法の観点から危険な条項をチェックリスト形式で解説。署名前に必ず確認を👇',
    url: 'https://freelance-articles.vercel.app/articles/contract-checklist',
  },
  {
    text: '「もう少し安くして」は法律違反になりえます。\n\nフリーランス新法第5条4号「買いたたきの禁止」：市場相場より著しく低い報酬を強いることは違法です👇',
    url: 'https://freelance-articles.vercel.app/articles/price-undercutting',
  },
  {
    text: '報酬が振り込まれない…そんな時の段階別対処法📌\n\n①確認メール②内容証明③公正取引委員会申告④少額訴訟\n\nフリーランス新法施行で支払い遅延は明確に違法。泣き寝入りしなくていい時代へ👇',
    url: 'https://freelance-articles.vercel.app/articles/late-payment-response',
  },
  {
    text: '「下請法って自分に関係ある？」\n\n→発注者の資本金が1000万円超なら関係あります。\n\nフリーランスへの適用条件とフリーランス新法との違いを解説👇',
    url: 'https://freelance-articles.vercel.app/articles/subcontract-law-applicability',
  },
  {
    text: '「明日から来なくていい」は2024年11月から違法です。\n\nフリーランス新法第16条：継続契約の中途解除は30日前の予告が必須。「いつでも解除できる」条項が入った契約書は要注意👇',
    url: 'https://freelance-articles.vercel.app/articles/instant-termination-illegal',
  },
  {
    text: '「方向性が変わったので不要です」は通じません。\n\nフリーランス新法が禁止する不当な返品・無限修正とは？気に入らないから返品・際限ない修正要求は違法です👇',
    url: 'https://freelance-articles.vercel.app/articles/return-prohibition',
  },
  {
    text: '【発注担当者の方へ】フリーランスへの発注で知らないと法律違反になる5つのこと。\n\n「中小企業だから関係ない」は誤りです。コンプライアンスチェックリスト付き👇',
    url: 'https://freelance-articles.vercel.app/articles/sme-freelance-ordering-caution',
  },
  {
    text: '「ちょっと修正して」が無限に続く問題。\n\nフリーランス新法では受託者の責めでない修正強要は違法。修正回数・費用の決め方と断り方のテンプレートを解説👇',
    url: 'https://freelance-articles.vercel.app/articles/revision-cost-liability',
  },
  {
    text: 'フリーランスへのパワハラ・セクハラ防止が企業の法的義務に。\n\nフリーランス新法第14条で発注企業に相談窓口設置が義務化。フリーランス側が知るべき権利と証拠保存法👇',
    url: 'https://freelance-articles.vercel.app/articles/harassment-prevention',
  },
]

const STATE_FILE = join(ROOT, 'scripts', '.post-queue-state.json')

function loadState() {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  }
  return { nextIndex: 0 }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state))
}

async function main() {
  const state = loadState()
  const post = POST_QUEUE[state.nextIndex % POST_QUEUE.length]

  console.log(`📤 投稿予定: ${post.url}`)

  const client = new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  })

  const tweetText = `${post.text}\n${post.url}`
  const { data } = await client.v2.tweet(tweetText)

  console.log(`✅ X投稿完了: https://x.com/i/web/status/${data.id}`)

  state.nextIndex = (state.nextIndex + 1) % POST_QUEUE.length
  saveState(state)
}

main().catch(err => {
  console.error('❌ エラー:', err.message)
  process.exit(1)
})
