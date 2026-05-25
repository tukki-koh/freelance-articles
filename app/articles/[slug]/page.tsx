import { getArticle, getAllSlugs } from '@/lib/articles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { MermaidLoader } from '@/components/MermaidLoader'

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
      {/* Mermaid ダイアグラム */}
      <MermaidLoader />

      {/* カラーボックス用スタイル */}
      <style>{`
        .prose .info-box    { background:#eff6ff; border-left:4px solid #3b82f6; padding:1rem 1.25rem; border-radius:0 8px 8px 0; margin:1.5rem 0; }
        .prose .warn-box    { background:#fffbeb; border-left:4px solid #f59e0b; padding:1rem 1.25rem; border-radius:0 8px 8px 0; margin:1.5rem 0; }
        .prose .danger-box  { background:#fef2f2; border-left:4px solid #ef4444; padding:1rem 1.25rem; border-radius:0 8px 8px 0; margin:1.5rem 0; }
        .prose .check-box   { background:#f0fdf4; border-left:4px solid #22c55e; padding:1rem 1.25rem; border-radius:0 8px 8px 0; margin:1.5rem 0; }
        .prose .summary-box { background:#f8fafc; border:2px solid #e2e8f0; padding:1.25rem 1.5rem; border-radius:12px; margin:1.5rem 0; }
        .prose table        { width:100%; border-collapse:collapse; margin:1.5rem 0; font-size:0.9rem; }
        .prose th           { background:#1e3a5f; color:#fff; padding:0.6rem 1rem; text-align:left; }
        .prose td           { padding:0.6rem 1rem; border-bottom:1px solid #e2e8f0; }
        .prose tr:nth-child(even) td { background:#f8fafc; }
        .prose .mermaid     { text-align:center; margin:1.5rem 0; }
        .prose blockquote   { border-left:4px solid #3b82f6; background:#eff6ff; margin:1.5rem 0; padding:0.75rem 1rem; border-radius:0 8px 8px 0; color:#1e40af; }
      `}</style>

      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-blue-600 mb-8 transition-colors"
      >
        ← 記事一覧に戻る
      </Link>

      <article className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-10">
        <div
          className="prose max-w-none"
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
