import Link from "next/link";
import { ArrowRight, Database, MessageSquare, BarChart3, Settings, Repeat } from "lucide-react";

export default function HomePage() {
  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 md:p-12 mb-8">
        <span className="inline-block px-3 py-1 bg-amber-100 text-amber-800 text-xs font-semibold rounded-full mb-4">
          Personal Research Tool
        </span>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 mb-3">
          RepostInsight
        </h1>
        <p className="text-slate-600 text-base md:text-lg max-w-2xl leading-relaxed mb-6">
          Platform analisis repost Instagram followers <code className="bg-slate-100 px-2 py-0.5 rounded text-amber-700 font-semibold">@ynsurabaya</code> dengan penyimpanan lokal Postgres+pgvector dan asisten analitik RAG cerdas.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-medium px-5 py-2.5 rounded-xl transition"
          >
            Buka Dashboard <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/reposts"
            className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-medium px-5 py-2.5 rounded-xl transition"
          >
            Katalog Repost <Repeat className="w-4 h-4" />
          </Link>
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium px-5 py-2.5 rounded-xl transition"
          >
            Chatbot RAG <MessageSquare className="w-4 h-4" />
          </Link>
          <Link
            href="/settings/followers"
            className="inline-flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-5 py-2.5 rounded-xl transition"
          >
            Import Followers <Database className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200">
          <Repeat className="w-8 h-8 text-amber-600 mb-3" />
          <h2 className="font-semibold text-slate-900 mb-1">Katalog Repost per Akun</h2>
          <p className="text-sm text-slate-600">
            Jelajahi seluruh postingan repost yang dikelompokkan rapi berdasarkan masing-masing akun follower.
          </p>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200">
          <BarChart3 className="w-8 h-8 text-amber-600 mb-3" />
          <h2 className="font-semibold text-slate-900 mb-1">Agregat & Tren</h2>
          <p className="text-sm text-slate-600">
            Top akun yang di-repost, tren hashtag, dan pola waktu aktivitas repost followers.
          </p>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200">
          <MessageSquare className="w-8 h-8 text-indigo-600 mb-3" />
          <h2 className="font-semibold text-slate-900 mb-1">Tanya Jawab RAG</h2>
          <p className="text-sm text-slate-600">
            Pencarian semantik konten repost dan analisis statistik otomatis via OpenRouter LLM.
          </p>
        </div>
      </div>
    </main>
  );
}
