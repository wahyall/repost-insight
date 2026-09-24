"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  Users,
  FileText,
  Repeat,
  Sparkles,
  RefreshCw,
  TrendingUp,
  UserCheck,
  Hash,
  ArrowLeft,
  Calendar,
  Layers,
} from "lucide-react";

interface DashboardData {
  overview: {
    totalFollowers: number;
    doneFollowers: number;
    totalPosts: number;
    totalRepostEvents: number;
    embeddingPending: number;
    embeddingDone: number;
    embeddingPercent: number;
  };
  topAccounts: {
    ownerUsername: string;
    repostCount: number;
    uniqueFollowersCount: number;
    totalLikes: number;
    totalPlays: number;
  }[];
  trendingHashtags: {
    tag: string;
    usageCount: number;
    uniqueRepostersCount: number;
  }[];
  timeline: {
    date: string;
    repostCount: number;
    activeFollowers: number;
  }[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/summary");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error("Gagal memuat ringkasan dashboard:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshMaterializedViews = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/dashboard/summary", { method: "POST" });
      await fetchDashboardData();
    } catch (err) {
      console.error("Gagal refresh materialized views:", err);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-slate-200 gap-4">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 mb-2 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Kembali ke Beranda
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-amber-600" />
            Dashboard Analitik Repost
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Insight statistik dari aktivitas repost followers @ynsurabaya berbasis Materialized View lokal.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/chat"
            className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition"
          >
            Tanya Chatbot RAG
          </Link>
          <button
            onClick={handleRefreshMaterializedViews}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-slate-700 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Memperbarui View..." : "Refresh Agregat"}
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="py-20 text-center text-slate-400">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-amber-500" />
          <p className="text-sm font-medium">Memuat data analitik...</p>
        </div>
      ) : (
        <>
          {/* Overview Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-6">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium">Followers Selesai</span>
                <Users className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {data?.overview.doneFollowers.toLocaleString("id-ID")}
                <span className="text-xs text-slate-400 font-normal ml-1.5">
                  / {data?.overview.totalFollowers.toLocaleString("id-ID")}
                </span>
              </p>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium">Post Original Unik</span>
                <FileText className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {data?.overview.totalPosts.toLocaleString("id-ID")}
              </p>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium">Total Kejadian Repost</span>
                <Repeat className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {data?.overview.totalRepostEvents.toLocaleString("id-ID")}
              </p>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-medium">Vektor Embedding</span>
                <Sparkles className="w-4 h-4 text-amber-500" />
              </div>
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold text-amber-600">
                  {data?.overview.embeddingPercent}%
                </p>
                <span className="text-xs text-slate-400">
                  ({data?.overview.embeddingDone} done)
                </span>
              </div>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Chart 1: Top Reposted Accounts */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-amber-600" />
                    Top Akun Paling Banyak Di-repost
                  </h2>
                  <p className="text-xs text-slate-500">
                    Akun sumber original yang kontennya paling sering dibagikan follower
                  </p>
                </div>
              </div>

              {data && data.topAccounts.length > 0 ? (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.topAccounts}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                      <XAxis type="number" fontSize={11} stroke="#94a3b8" />
                      <YAxis
                        type="category"
                        dataKey="ownerUsername"
                        fontSize={11}
                        stroke="#64748b"
                        width={90}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          borderRadius: "8px",
                          border: "none",
                          color: "#fff",
                          fontSize: "12px",
                        }}
                        formatter={(val: number) => [`${val} repost`, "Jumlah Repost"]}
                      />
                      <Bar dataKey="repostCount" fill="#e05328" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="py-16 text-center text-xs text-slate-400">
                  Belum ada data akun. Silakan jalankan scraping terlebih dahulu.
                </p>
              )}
            </div>

            {/* Chart 2: Timeline Aktivitas Repost */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-indigo-600" />
                    Tren Waktu Aktivitas Repost
                  </h2>
                  <p className="text-xs text-slate-500">
                    Jumlah postingan repost yang discrape dari waktu ke waktu
                  </p>
                </div>
              </div>

              {data && data.timeline.length > 0 ? (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={data.timeline}
                      margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorRepost" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="date" fontSize={11} stroke="#94a3b8" />
                      <YAxis fontSize={11} stroke="#94a3b8" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          borderRadius: "8px",
                          border: "none",
                          color: "#fff",
                          fontSize: "12px",
                        }}
                        formatter={(val: number) => [`${val} repost`, "Kejadian Repost"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="repostCount"
                        stroke="#6366f1"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorRepost)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="py-16 text-center text-xs text-slate-400">
                  Belum ada data timeline aktivitas repost.
                </p>
              )}
            </div>
          </div>

          {/* Hashtag & Detailed Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Trending Hashtags */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm lg:col-span-1">
              <h2 className="text-base font-semibold text-slate-900 mb-1 flex items-center gap-2">
                <Hash className="w-4 h-4 text-emerald-600" />
                Trending Hashtags
              </h2>
              <p className="text-xs text-slate-500 mb-4">
                Hashtag yang paling dominan muncul pada postingan repost
              </p>

              <div className="flex flex-wrap gap-2">
                {data && data.trendingHashtags.length > 0 ? (
                  data.trendingHashtags.map((h) => (
                    <span
                      key={h.tag}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-slate-50 border border-slate-200 text-slate-700 hover:bg-amber-50 hover:border-amber-200 transition"
                    >
                      <span className="font-semibold text-amber-700">#{h.tag}</span>
                      <span className="text-[10px] bg-slate-200/80 px-1.5 py-0.5 rounded-full text-slate-600 font-mono">
                        {h.usageCount}
                      </span>
                    </span>
                  ))
                ) : (
                  <p className="text-xs text-slate-400">Belum ada hashtag terdeteksi.</p>
                )}
              </div>
            </div>

            {/* Top Accounts Table Details */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm lg:col-span-2">
              <div className="p-4 border-b border-slate-200 bg-slate-50/50">
                <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-slate-500" />
                  Rincian Statistik Top Akun
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Akun Sumber</th>
                      <th className="py-3 px-4">Jumlah Repost</th>
                      <th className="py-3 px-4">Follower Unik</th>
                      <th className="py-3 px-4">Akumulasi Likes</th>
                      <th className="py-3 px-4">Akumulasi Plays</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data?.topAccounts.map((acc) => (
                      <tr key={acc.ownerUsername} className="hover:bg-slate-50 transition">
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          <a
                            href={`https://instagram.com/${acc.ownerUsername}`}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-amber-600 hover:underline"
                          >
                            @{acc.ownerUsername}
                          </a>
                        </td>
                        <td className="py-3 px-4 font-bold text-amber-700">
                          {acc.repostCount.toLocaleString("id-ID")}
                        </td>
                        <td className="py-3 px-4">
                          {acc.uniqueFollowersCount.toLocaleString("id-ID")} orang
                        </td>
                        <td className="py-3 px-4">
                          {acc.totalLikes > 0 ? acc.totalLikes.toLocaleString("id-ID") : "—"}
                        </td>
                        <td className="py-3 px-4">
                          {acc.totalPlays > 0 ? acc.totalPlays.toLocaleString("id-ID") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
