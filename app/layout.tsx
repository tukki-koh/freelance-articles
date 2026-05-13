import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "フリーランス新法 契約書チェック ガイド",
  description: "フリーランス新法・下請法に関する実践的な解説記事。支払い期日・返品禁止・買いたたき・解除予告など、フリーランスと発注企業が知るべき法律知識をわかりやすく解説します。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" className={`${geistSans.variable}`}>
      <body className="min-h-full flex flex-col bg-slate-50">
        <header className="bg-slate-900 text-white">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
            <a href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <span className="text-blue-400 text-xl">⚖️</span>
              <span className="font-bold text-lg tracking-tight">フリーランス新法ガイド</span>
            </a>
            <span className="ml-auto text-slate-400 text-sm">契約書リスク 無料解説</span>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="bg-slate-900 text-slate-400 text-sm mt-16">
          <div className="max-w-4xl mx-auto px-4 py-8">
            <p className="mb-2 font-semibold text-slate-300">フリーランス新法ガイド</p>
            <p className="mb-4">フリーランス新法・下請法に基づく契約書リスクをわかりやすく解説するメディアサイトです。</p>
            <p>※ 本サイトの情報は参考情報であり、法的アドバイスではありません。個別の法律問題については弁護士等の専門家にご相談ください。</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
