import { getAllArticles } from '@/lib/articles'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'フリーランス新法ガイド｜契約書・下請法・支払いトラブル 実践解説',
  description: 'フリーランス新法・下請法の実践解説。支払い期日60日ルール・買いたたき禁止・即日解除違法など、フリーランスが知るべき法律知識を条文番号付きで解説。AIによる契約書診断ツールも提供。',
}

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
  'freelance-law-applicable-check': '適用範囲',
  'dangerous-contract-clauses': '危険条項',
  'unpaid-freelance-response': '未払い対応',
  'ordering-side-compliance': '発注者向け',
  'freelance-law-vs-subcontract-law': '法律比較',
  '個人事業主とフリーランスの違い｜フリーランス新法の適用はどちらか': '適用範囲',
}

const POPULAR_KEYWORDS = [
  'フリーランス新法 支払い期日',
  '業務委託契約書 チェックリスト',
  'フリーランス 買いたたき 禁止',
  '下請法 適用範囲',
  '即日解除 違法',
  'フリーランス 未払い 対処法',
  'フリーランス新法 発注者 義務',
  '修正 無償 断り方',
]

export default function HomePage() {
  const articles = getAllArticles()

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">

      {/* ヒーロー */}
      <div className="text-center mb-10">
        <span className="inline-block bg-blue-100 text-blue-700 text-xs font-bold px-3 py-1 rounded-full mb-4">
          フリーランス新法 2024年11月施行 対応
        </span>
        <h1 className="text-3xl font-bold text-slate-900 mb-4">
          フリーランス新法 契約書ガイド
        </h1>
        <p className="text-slate-600 max-w-2xl mx-auto leading-relaxed">
          フリーランス新法・下請法に基づき、契約書のリスク条項・違法な取引慣行・対処法を
          <strong>条文番号付き</strong>でわかりやすく解説します。
        </p>
      </div>

      {/* CTA バナー */}
      <a
        href="https://freelance-contract-checker.vercel.app"
        target="_blank"
        rel="noopener noreferrer"
        className="block bg-blue-600 hover:bg-blue-700 transition-colors rounded-xl p-5 mb-10 shadow-lg"
      >
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div className="text-2xl">📋</div>
          <div className="flex-1">
            <p className="font-bold text-white mb-1">契約書を今すぐAIでチェック →</p>
            <p className="text-blue-100 text-sm">フリーランス新法・下請法への違反リスクを条文番号付きで自動検出。<strong className="text-white">無料で1回お試し</strong>・500円から。</p>
          </div>
          <span className="shrink-0 bg-white text-blue-700 font-bold text-sm px-4 py-2 rounded-lg">
            無料で試す →
          </span>
        </div>
      </a>

      {/* 人気キーワード */}
      <div className="mb-10">
        <p className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">よく検索されるキーワード</p>
        <div className="flex flex-wrap gap-2">
          {POPULAR_KEYWORDS.map(kw => (
            <span key={kw} className="bg-slate-100 text-slate-600 text-xs px-3 py-1.5 rounded-full border border-slate-200">
              {kw}
            </span>
          ))}
        </div>
      </div>

      {/* 記事一覧 */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-slate-800">📚 記事一覧（全{articles.length}本）</h2>
      </div>

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

      {/* 下部CTA */}
      <div className="mt-12 rounded-xl border border-blue-200 bg-blue-50 p-6 text-center">
        <p className="font-bold text-slate-800 mb-2">記事を読んで「自分の契約書も確認したい」と思ったら</p>
        <p className="text-sm text-slate-600 mb-4">AIが30秒で全条項をスキャン。違反箇所を条文番号付きで指摘します。</p>
        <a
          href="https://freelance-contract-checker.vercel.app"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-lg transition-colors text-sm"
        >
          無料登録で1回お試し →
        </a>
      </div>
    </div>
  )
}
