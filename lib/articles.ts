import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { remark } from 'remark'
import remarkHtml from 'remark-html'

const ROOT = path.join(process.cwd())

const ARTICLE_FILES = [
  { slug: '60day-rule-violation', file: '01_60day-rule-violation.md' },
  { slug: 'contract-checklist', file: '02_contract-checklist.md' },
  { slug: 'price-undercutting', file: '03_price-undercutting.md' },
  { slug: 'late-payment-response', file: '04_late-payment-response.md' },
  { slug: 'subcontract-law-applicability', file: '05_subcontract-law-applicability.md' },
  { slug: 'instant-termination-illegal', file: '06_instant-termination-illegal.md' },
  { slug: 'return-prohibition', file: '07_return-prohibition.md' },
  { slug: 'sme-freelance-ordering-caution', file: '08_sme-freelance-ordering-caution.md' },
  { slug: 'revision-cost-liability', file: '09_revision-cost-liability.md' },
  { slug: 'harassment-prevention', file: '10_harassment-prevention.md' },
  { slug: 'freelance-law-applicable-check', file: '11_freelance-law-applicable-check.md' },
  { slug: 'dangerous-contract-clauses', file: '12_dangerous-contract-clauses.md' },
  { slug: 'unpaid-freelance-response', file: '13_unpaid-freelance-response.md' },
  { slug: 'ordering-side-compliance', file: '14_ordering-side-compliance.md' },
  { slug: 'freelance-law-vs-subcontract-law', file: '15_freelance-law-vs-subcontract-law.md' },
]

export type ArticleMeta = {
  slug: string
  title: string
  description: string
}

export type Article = ArticleMeta & {
  contentHtml: string
}

function extractMeta(content: string, slug: string): ArticleMeta {
  const titleMatch = content.match(/^#\s+(.+)$/m)
  const descMatch = content.match(/\*\*メタディスクリプション：\*\*\s*(.+)/)
  return {
    slug,
    title: titleMatch?.[1] ?? slug,
    description: descMatch?.[1] ?? '',
  }
}

export function getAllArticles(): ArticleMeta[] {
  return ARTICLE_FILES.map(({ slug, file }) => {
    const raw = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const { content } = matter(raw)
    return extractMeta(content, slug)
  })
}

export async function getArticle(slug: string): Promise<Article | null> {
  const entry = ARTICLE_FILES.find((a) => a.slug === slug)
  if (!entry) return null

  const raw = fs.readFileSync(path.join(ROOT, entry.file), 'utf8')
  const { content } = matter(raw)
  const meta = extractMeta(content, slug)

  const processed = await remark().use(remarkHtml, { sanitize: false }).process(content)
  return { ...meta, contentHtml: processed.toString() }
}

export function getAllSlugs(): string[] {
  return ARTICLE_FILES.map((a) => a.slug)
}
