import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { remark } from 'remark'
import remarkHtml from 'remark-html'

const ROOT = path.join(process.cwd())

function scanArticleFiles(): { slug: string; file: string }[] {
  const files = fs.readdirSync(ROOT)
    .filter(f => /^\d+_[\w-]+\.md$/.test(f))
    .sort()

  return files.map(file => {
    const slug = file.replace(/^\d+_/, '').replace(/\.md$/, '')
    return { slug, file }
  })
}

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
  return scanArticleFiles().map(({ slug, file }) => {
    const raw = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const { content } = matter(raw)
    return extractMeta(content, slug)
  })
}

export async function getArticle(slug: string): Promise<Article | null> {
  const entry = scanArticleFiles().find((a) => a.slug === slug)
  if (!entry) return null

  const raw = fs.readFileSync(path.join(ROOT, entry.file), 'utf8')
  const { content } = matter(raw)
  const meta = extractMeta(content, slug)

  const processed = await remark().use(remarkHtml, { sanitize: false }).process(content)
  return { ...meta, contentHtml: processed.toString() }
}

export function getAllSlugs(): string[] {
  return scanArticleFiles().map((a) => a.slug)
}
