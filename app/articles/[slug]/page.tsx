import { getArticle, getAllSlugs } from '@/lib/articles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'

type Props = { params: Promise<{ slug: string }> }

export async function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const article = await getArticle(slug)
  if (!article) return {}
  return {
    title: `${article.title} | フリーランス新法ガイド`,
    description: article.description,
  }
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params
  const article = await getArticle(slug)
  if (!article) notFound()

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-blue-600 mb-8 transition-colors"
      >
        ← 記事一覧に戻る
      </Link>

      <article className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-10">
        <div
          className="prose"
          dangerouslySetInnerHTML={{ __html: article.contentHtml }}
        />
      </article>

      <a
        href="https://freelance-contract-checker.vercel.app"
        target="_blank"
        rel="noopener noreferrer"
        className="block mt-10 bg-blue-600 hover:bg-blue-700 transition-colors rounded-xl p-6 text-center"
      >
        <p className="font-bold text-white mb-2">契約書のリスクをAIで今すぐチェック →</p>
        <p className="text-sm text-blue-100 mb-3">
          フリーランス新法・下請法の観点から契約書を分析。違反リスクを条文番号付きで指摘します。
        </p>
        <span className="inline-block bg-white text-blue-700 font-semibold px-6 py-2 rounded-full text-sm">
          500円から始める
        </span>
      </a>

      <div className="mt-6 text-center">
        <Link href="/" className="text-sm text-slate-500 hover:text-blue-600 transition-colors">
          ← 他の記事を読む
        </Link>
      </div>
    </div>
  )
}
