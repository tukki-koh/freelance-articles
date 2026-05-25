#!/usr/bin/env node
/**
 * 既存10記事をnoteに週1本ずつ自動投稿
 * GitHub Actions から毎週火曜 朝8時に実行
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { postToNote } from './post-to-note.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const ARTICLE_FILES = [
  { slug: '60day-rule-violation',          file: '01_60day-rule-violation.md' },
  { slug: 'contract-checklist',            file: '02_contract-checklist.md' },
  { slug: 'price-undercutting',            file: '03_price-undercutting.md' },
  { slug: 'late-payment-response',         file: '04_late-payment-response.md' },
  { slug: 'subcontract-law-applicability', file: '05_subcontract-law-applicability.md' },
  { slug: 'instant-termination-illegal',   file: '06_instant-termination-illegal.md' },
  { slug: 'return-prohibition',            file: '07_return-prohibition.md' },
  { slug: 'sme-freelance-ordering-caution',file: '08_sme-freelance-ordering-caution.md' },
  { slug: 'revision-cost-liability',       file: '09_revision-cost-liability.md' },
  { slug: 'harassment-prevention',         file: '10_harassment-prevention.md' },
  { slug: 'freelance-law-applicable-check',file: '11_freelance-law-applicable-check.md' },
  { slug: 'dangerous-contract-clauses',    file: '12_dangerous-contract-clauses.md' },
  { slug: 'unpaid-freelance-response',     file: '13_unpaid-freelance-response.md' },
  { slug: 'ordering-side-compliance',      file: '14_ordering-side-compliance.md' },
  { slug: 'freelance-law-vs-subcontract-law', file: '15_freelance-law-vs-subcontract-law.md' },
  { slug: 'gyomu-itaku-keiyakusho-check',    file: '17_gyomu-itaku-keiyakusho-check.md' },
  { slug: 'freelance-miharai-jiko',          file: '18_freelance-miharai-jiko.md' },
]

const STATE_FILE = join(ROOT, 'scripts', '.note-queue-state.json')

function loadState() {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  return { nextIndex: 0 }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state))
}

async function main() {
  const state = loadState()
  const article = ARTICLE_FILES[state.nextIndex % ARTICLE_FILES.length]

  const content = readFileSync(join(ROOT, article.file), 'utf8')
  const titleMatch = content.match(/^#\s+(.+)$/m)
  const title = titleMatch?.[1] ?? article.slug

  // CTAを除いた本文を使用
  const body = content
    .replace(/^#\s+.+$/m, '')  // H1タイトルを除去（noteのタイトル欄に入れるため）
    .trim()

  console.log(`📤 note投稿予定: ${title}`)
  await postToNote(title, body)

  state.nextIndex = (state.nextIndex + 1) % ARTICLE_FILES.length
  saveState(state)
}

main().catch(err => {
  console.error('❌ エラー:', err.message)
  process.exit(1)
})
