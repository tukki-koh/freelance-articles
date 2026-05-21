import { MetadataRoute } from 'next'
import { getAllSlugs } from '@/lib/articles'

const BASE_URL = 'https://freelance-articles.vercel.app'

export default function sitemap(): MetadataRoute.Sitemap {
  // 全記事を動的に取得（新記事追加時も自動反映）
  const slugs = getAllSlugs()

  const articles = slugs.map((slug) => ({
    url: `${BASE_URL}/articles/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }))

  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 1.0,
    },
    ...articles,
  ]
}
