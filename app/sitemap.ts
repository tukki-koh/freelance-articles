import { MetadataRoute } from 'next'

const BASE_URL = 'https://freelance-articles.vercel.app'

const SLUGS = [
  '60day-rule-violation',
  'contract-checklist',
  'price-undercutting',
  'late-payment-response',
  'subcontract-law-applicability',
  'instant-termination-illegal',
  'return-prohibition',
  'sme-freelance-ordering-caution',
  'revision-cost-liability',
  'harassment-prevention',
]

export default function sitemap(): MetadataRoute.Sitemap {
  const articles = SLUGS.map((slug) => ({
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
