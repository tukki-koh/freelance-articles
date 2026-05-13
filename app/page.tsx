import { getAllArticles } from '@/lib/articles'
import Link from 'next/link'

const CATEGORY_LABELS: Record<string, string> = {
  '60day-rule-violation': '支払い期日',
  'contract-checklist': 'チェックリスト',
  'price-undercutting': '買いたたき',
  'late-payment-response': '支払い遅延',
  'subcontract-law-applicability': '下請法',
  'instant-termination-illegal': '契約解除',
  'return-prohibition': '返品禁止',
  'sme-freelance-ordering-caution': '発注者向け',
  'revision-cost-liability': '修正・やり直し',
  'harassment-prevention': 'ハラスメント',
}

export default function HomePage() {
  const articles = getAllArticles()

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold text-slate-900 mb-4">
          フリーランス新法 契約書ガイド
        </h1>
        <p className="text-slate-600 max-w-2xl mx-auto leading-relaxed">
          2024年11月施行のフリーランス新法と下請法に基づき、契約書のリスク条項・違法な取引慣行・対処法をわかりやすく解説します。
        </p>
      </div>

      <a
        href="https://freelance-contract-checker.vercel.app"
        target="_blank"
        rel="noopener noreferrer"
        className="block bg-blue-600 hover:bg-blue-700 transition-colors rounded-xl p-5 mb-10"
      >
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div className="text-2xl">📋</div>
          <div className="flex-1">
            <p className="font-bold text-white mb-1">契約書を今すぐAIでチェック →</p>
            <p className="text-blue-100 text-sm">フリーランス新法・下請法への違反リスクを条文番号付きで自動検出。500円から。</p>
          </div>
        </div>
      </a>

      <h2 className="text-xl font-bold text-slate-800 mb-6">📚 記事一覧</h2>

      <div className="grid gap-4">
        {articles.map((article) => (
          <Link
            key={article.slug}
            href={`/articles/${article.slug}`}
            className="block bg-white rounded-xl border border-slate-200 p-5 hover:border-blue-400 hover:shadow-md transition-all group"
          >
            <div className="flex items-start gap-3">
              <span className="inline-block bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-1 rounded mt-0.5 whitespace-nowrap">
                {CATEGORY_LABELS[article.slug] ?? '解説'}
              </span>
              <div>
                <h3 className="font-bold text-slate-900 group-hover:text-blue-700 transition-colors leading-snug mb-1">
                  {article.title}
                </h3>
                <p className="text-sm text-slate-500">{article.description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
