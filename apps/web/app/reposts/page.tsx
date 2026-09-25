"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Repeat,
  Users,
  Search,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Calendar,
  Sparkles,
  Heart,
  Play,
  Image as ImageIcon,
  Layers,
  RefreshCw,
  CheckCircle2,
  Clock,
  XCircle,
  User,
  SlidersHorizontal,
  RotateCcw,
  Maximize2,
  X,
  Share2,
  Check,
} from "lucide-react";

interface PostItem {
  id: string;
  code: string | null;
  ownerUsername: string | null;
  captionText: string | null;
  hashtags: string[];
  mediaType: string | null;
  likeCount: number | null;
  playCount: number | null;
  takenAt: string | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  visualDescription: string | null;
  visualDescriptionStatus: string;
  embeddingStatus: string;
}

interface RepostItem {
  eventId: number;
  scrapedAt: string;
  post: PostItem;
}

interface FollowerGroup {
  username: string;
  status: "pending" | "in_progress" | "done" | "failed";
  lastScrapedAt: string | null;
  createdAt: string;
  totalReposts: number;
  matchingRepostsCount: number;
  originalCreators: string[];
  reposts: RepostItem[];
}

interface RepostsResponse {
  summary: {
    totalFollowersWithReposts: number;
    totalEvents: number;
    totalPosts: number;
    totalVisualDone: number;
    avgRepostsPerFollower: number;
  };
  pagination: {
    page: number;
    limit: number;
    totalFollowers: number;
    totalPages: number;
  };
  followers: FollowerGroup[];
}

export default function RepostsCatalogPage() {
  const [data, setData] = useState<RepostsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters state
  const [followerSearch, setFollowerSearch] = useState("");
  const [contentSearch, setContentSearch] = useState("");
  const [mediaType, setMediaType] = useState("all");
  const [hasVisual, setHasVisual] = useState("all");
  const [sort, setSort] = useState("most_reposts");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  // Accordion state: Set of follower usernames that are open
  const [openFollowers, setOpenFollowers] = useState<Set<string>>(new Set());

  // Expanded captions state
  const [expandedCaptions, setExpandedCaptions] = useState<Set<string>>(new Set());

  // Modal inspection state
  const [selectedPost, setSelectedPost] = useState<{
    post: PostItem;
    followerUsername: string;
    scrapedAt: string;
  } | null>(null);

  // Copy notification state
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const fetchReposts = async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const url = new URL("/api/reposts", window.location.origin);
      url.searchParams.set("page", page.toString());
      url.searchParams.set("limit", limit.toString());
      url.searchParams.set("sort", sort);

      if (followerSearch.trim()) {
        url.searchParams.set("follower", followerSearch.trim());
      }
      if (contentSearch.trim()) {
        url.searchParams.set("search", contentSearch.trim());
      }
      if (mediaType !== "all") {
        url.searchParams.set("mediaType", mediaType);
      }
      if (hasVisual !== "all") {
        url.searchParams.set("hasVisual", hasVisual);
      }

      const res = await fetch(url.toString());
      if (res.ok) {
        const json: RepostsResponse = await res.json();
        setData(json);

        // Auto-expand all followers on first load if total followers <= 5
        if (json.followers.length <= 5 && !isManualRefresh) {
          setOpenFollowers(new Set(json.followers.map((f) => f.username)));
        }
      }
    } catch (err) {
      console.error("Gagal memuat katalog repost:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchReposts();
  }, [page, limit, sort, mediaType, hasVisual]);

  // Debounced search trigger for text inputs
  useEffect(() => {
    const handler = setTimeout(() => {
      setPage(1);
      fetchReposts();
    }, 350);
    return () => clearTimeout(handler);
  }, [followerSearch, contentSearch]);

  const toggleFollower = (username: string) => {
    setOpenFollowers((prev) => {
      const next = new Set(prev);
      if (next.has(username)) {
        next.delete(username);
      } else {
        next.add(username);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (!data) return;
    setOpenFollowers(new Set(data.followers.map((f) => f.username)));
  };

  const collapseAll = () => {
    setOpenFollowers(new Set());
  };

  const toggleCaption = (postId: string) => {
    setExpandedCaptions((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  };

  const resetFilters = () => {
    setFollowerSearch("");
    setContentSearch("");
    setMediaType("all");
    setHasVisual("all");
    setSort("most_reposts");
    setPage(1);
  };

  const handleCopyLink = (code: string | null) => {
    if (!code) return;
    const url = `https://instagram.com/p/${code}`;
    navigator.clipboard.writeText(url);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const hasActiveFilters =
    followerSearch !== "" ||
    contentSearch !== "" ||
    mediaType !== "all" ||
    hasVisual !== "all" ||
    sort !== "most_reposts";

  return (
    <div className="min-h-screen bg-slate-50/60 pb-16">
      {/* Top Ambient Bar */}
      <div className="bg-white border-b border-slate-200/80 sticky top-14 z-20 shadow-[0_1px_3px_rgba(0,0,0,0.03)] backdrop-blur-md bg-white/95">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link
                href="/"
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 transition font-medium"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Beranda
              </Link>
              <span className="text-slate-300">/</span>
              <span className="text-xs text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200/60">
                Katalog Repost
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 text-white flex items-center justify-center font-black shadow-sm shadow-amber-500/20">
                <Repeat className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 flex items-center gap-2">
                  Katalog Repost Followers
                </h1>
                <p className="text-xs text-slate-500">
                  Eksplorasi seluruh konten repost audiens @ynsurabaya, dikelompokkan rapi per akun follower.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={() => fetchReposts(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-200 rounded-xl text-slate-700 transition shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-amber-600" : ""}`} />
              {refreshing ? "Menyinkronkan..." : "Segarkan"}
            </button>

            <button
              onClick={openFollowers.size > 0 ? collapseAll : expandAll}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-xl transition shadow-sm"
            >
              {openFollowers.size > 0 ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  Tutup Semua Akun
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  Buka Semua Akun
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
        {/* Metric Cards Bento */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Card 1: Followers */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden group hover:border-slate-300 transition">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-amber-400" />
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Follower Reposter
              </span>
              <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {data?.summary.totalFollowersWithReposts.toLocaleString("id-ID") ?? "0"}
              <span className="text-xs text-slate-400 font-normal ml-1.5">akun</span>
            </p>
            <p className="text-[11px] text-slate-500 mt-1">Memiliki minimal 1 konten repost</p>
          </div>

          {/* Card 2: Total Events */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden group hover:border-amber-300 transition">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-orange-500 to-amber-500" />
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Total Repost
              </span>
              <div className="w-7 h-7 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
                <Repeat className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-amber-600 tracking-tight">
              {data?.summary.totalEvents.toLocaleString("id-ID") ?? "0"}
              <span className="text-xs text-slate-400 font-normal ml-1.5">event</span>
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Dari {data?.summary.totalPosts.toLocaleString("id-ID") ?? "0"} post unik
            </p>
          </div>

          {/* Card 3: Rerata */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden group hover:border-indigo-300 transition">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-blue-500" />
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Rerata per Follower
              </span>
              <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <SlidersHorizontal className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {data?.summary.avgRepostsPerFollower ?? "0"}
              <span className="text-xs text-slate-400 font-normal ml-1.5">post / akun</span>
            </p>
            <p className="text-[11px] text-slate-500 mt-1">Intensitas sebaran konten</p>
          </div>

          {/* Card 4: AI Visual */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden group hover:border-emerald-300 transition">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Analisis Visual AI
              </span>
              <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-emerald-600 tracking-tight">
              {data?.summary.totalVisualDone.toLocaleString("id-ID") ?? "0"}
              <span className="text-xs text-slate-400 font-normal ml-1.5">selesai</span>
            </p>
            <p className="text-[11px] text-slate-500 mt-1">Scene visual & OCR terekstrak</p>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 mb-8 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-center">
            {/* Follower search */}
            <div className="relative lg:col-span-3">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={followerSearch}
                onChange={(e) => setFollowerSearch(e.target.value)}
                placeholder="Cari follower (@username)..."
                className="w-full text-xs pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition"
              />
            </div>

            {/* Content / creator / hashtag search */}
            <div className="relative lg:col-span-4">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={contentSearch}
                onChange={(e) => setContentSearch(e.target.value)}
                placeholder="Cari caption, hashtag (#), atau kreator (@)..."
                className="w-full text-xs pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition"
              />
            </div>

            {/* Media type filter */}
            <div className="lg:col-span-2">
              <select
                value={mediaType}
                onChange={(e) => {
                  setMediaType(e.target.value);
                  setPage(1);
                }}
                className="w-full text-xs py-2.5 px-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition"
              >
                <option value="all">Semua Format Media</option>
                <option value="Video">Video / Reels</option>
                <option value="Image">Foto / Gambar</option>
                <option value="Sidecar">Carousel / Album</option>
              </select>
            </div>

            {/* Visual AI filter */}
            <div className="lg:col-span-2">
              <select
                value={hasVisual}
                onChange={(e) => {
                  setHasVisual(e.target.value);
                  setPage(1);
                }}
                className="w-full text-xs py-2.5 px-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition"
              >
                <option value="all">Semua Status Visi AI</option>
                <option value="done">Sudah Dianalisis</option>
                <option value="pending">Antrean Pending</option>
                <option value="failed">Gagal / Belum</option>
              </select>
            </div>

            {/* Sort selector */}
            <div className="lg:col-span-1">
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(1);
                }}
                className="w-full text-xs py-2.5 px-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition"
                title="Urutan Tampilan"
              >
                <option value="most_reposts">Banyak Repost</option>
                <option value="latest_scraped">Terbaru Di-scrape</option>
                <option value="username_asc">Nama (A-Z)</option>
              </select>
            </div>
          </div>

          {/* Filter badges indicator */}
          {hasActiveFilters && (
            <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-700">Filter Aktif:</span>
                {followerSearch && (
                  <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-900 border border-amber-200 font-medium flex items-center gap-1">
                    Follower: @{followerSearch}
                    <button
                      onClick={() => setFollowerSearch("")}
                      className="hover:text-amber-700 text-amber-500"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {contentSearch && (
                  <span className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-900 border border-indigo-200 font-medium flex items-center gap-1">
                    Kueri: {contentSearch}
                    <button
                      onClick={() => setContentSearch("")}
                      className="hover:text-indigo-700 text-indigo-500"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {mediaType !== "all" && (
                  <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 border border-slate-200 font-medium flex items-center gap-1">
                    Format: {mediaType}
                    <button
                      onClick={() => setMediaType("all")}
                      className="hover:text-slate-900 text-slate-500"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {hasVisual !== "all" && (
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-900 border border-emerald-200 font-medium flex items-center gap-1">
                    Visi AI: {hasVisual}
                    <button
                      onClick={() => setHasVisual("all")}
                      className="hover:text-emerald-700 text-emerald-500"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </div>

              <button
                onClick={resetFilters}
                className="inline-flex items-center gap-1 text-slate-600 hover:text-amber-700 transition font-semibold"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Semua Filter
              </button>
            </div>
          )}
        </div>

        {/* Content Section */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm animate-pulse"
              >
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-slate-200" />
                    <div>
                      <div className="w-36 h-4 bg-slate-200 rounded mb-2" />
                      <div className="w-52 h-3 bg-slate-100 rounded" />
                    </div>
                  </div>
                  <div className="w-28 h-8 bg-slate-100 rounded-xl" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 pt-4 border-t border-slate-100">
                  <div className="aspect-[4/5] bg-slate-100 rounded-2xl" />
                  <div className="aspect-[4/5] bg-slate-100 rounded-2xl hidden md:block" />
                  <div className="aspect-[4/5] bg-slate-100 rounded-2xl hidden lg:block" />
                </div>
              </div>
            ))}
          </div>
        ) : !data || data.followers.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200/80 p-12 text-center shadow-sm max-w-xl mx-auto my-8">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-200/60 shadow-sm">
              <Repeat className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1.5">
              Tidak Ada Repost Ditemukan
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed mb-6">
              {hasActiveFilters
                ? "Tidak ada postingan repost yang sesuai dengan kombinasi filter dan kata kunci saat ini. Coba sesuaikan kata kunci pencarian Anda."
                : "Belum ada follower yang memiliki data repost tersimpan di database. Silakan jalankan modul worker scraping pada menu Followers."}
            </p>
            {hasActiveFilters ? (
              <button
                onClick={resetFilters}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl transition shadow-md shadow-amber-600/20"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Filter Pencarian
              </button>
            ) : (
              <Link
                href="/settings/followers"
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-xl transition shadow-sm"
              >
                Buka Manajemen Followers
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {data.followers.map((follower) => {
              const isOpen = openFollowers.has(follower.username);

              return (
                <div
                  key={follower.username}
                  className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden hover:border-slate-300 transition-all duration-200"
                >
                  {/* Follower Accordion Header */}
                  <div
                    onClick={() => toggleFollower(follower.username)}
                    className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer select-none hover:bg-slate-50/70 transition"
                  >
                    <div className="flex items-start sm:items-center gap-3.5">
                      {/* Avatar with monogram */}
                      <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-600 text-white flex items-center justify-center font-black text-base shadow-sm shadow-amber-500/20 flex-shrink-0">
                        {follower.username.charAt(0).toUpperCase()}
                      </div>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <a
                            href={`https://instagram.com/${follower.username}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="font-bold text-slate-900 hover:text-amber-600 transition flex items-center gap-1.5 text-sm sm:text-base group"
                            title="Buka profil follower di Instagram"
                          >
                            <span>@{follower.username}</span>
                            <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-amber-600 transition" />
                          </a>

                          {/* Status Pill */}
                          {follower.status === "done" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Selesai
                            </span>
                          )}
                          {follower.status === "in_progress" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                              <RefreshCw className="w-3 h-3 text-blue-600 animate-spin" />
                              Sedang Scrape
                            </span>
                          )}
                          {follower.status === "pending" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                              <Clock className="w-3 h-3 text-amber-600" />
                              Pending
                            </span>
                          )}
                          {follower.status === "failed" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              <XCircle className="w-3 h-3 text-rose-600" />
                              Gagal
                            </span>
                          )}

                          {/* Count Badge */}
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100/70 text-amber-900 border border-amber-200/80">
                            {follower.matchingRepostsCount} Repost Tersimpan
                          </span>
                        </div>

                        {/* Metadata row */}
                        <div className="flex items-center gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                          {follower.lastScrapedAt ? (
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-slate-400" />
                              Di-scrape:{" "}
                              {new Date(follower.lastScrapedAt).toLocaleString("id-ID", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          ) : (
                            <span className="text-slate-400">Belum di-scrape</span>
                          )}

                          {follower.originalCreators.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="text-slate-400">Kreator:</span>
                              {follower.originalCreators.slice(0, 3).map((creator) => (
                                <button
                                  key={creator}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setContentSearch(creator);
                                    setPage(1);
                                  }}
                                  className="text-[11px] font-semibold text-slate-700 hover:text-amber-700 bg-slate-100 hover:bg-amber-50 px-1.5 py-0.5 rounded transition"
                                >
                                  @{creator}
                                </button>
                              ))}
                              {follower.originalCreators.length > 3 && (
                                <span className="text-[10px] text-slate-400">
                                  +{follower.originalCreators.length - 3} lainnya
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Expand/Collapse action */}
                    <div className="flex items-center gap-2.5 self-end md:self-center">
                      <span className="text-xs text-slate-500 font-semibold">
                        {isOpen ? "Sembunyikan" : `Lihat ${follower.matchingRepostsCount} Repost`}
                      </span>
                      <div
                        className={`w-8 h-8 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-600 transition-transform duration-200 ${
                          isOpen ? "rotate-180 bg-slate-900 text-white border-slate-900" : ""
                        }`}
                      >
                        <ChevronDown className="w-4 h-4" />
                      </div>
                    </div>
                  </div>

                  {/* Accordion Body: Cards Grid */}
                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/50 p-4 sm:p-6">
                      {follower.reposts.length === 0 ? (
                        <p className="text-xs text-slate-400 py-8 text-center">
                          Tidak ada repost yang cocok dengan kriteria pencarian untuk akun ini.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                          {follower.reposts.map(({ eventId, scrapedAt, post }) => {
                            const isCaptionExpanded = expandedCaptions.has(post.id);
                            const isLongCaption =
                              post.captionText && post.captionText.length > 120;
                            const isVideo = post.mediaType === "Video" || Boolean(post.videoUrl);

                            return (
                              <div
                                key={eventId}
                                className="bg-white rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200 flex flex-col justify-between overflow-hidden group"
                              >
                                <div>
                                  {/* Thumbnail Aspect Ratio Container */}
                                  <div
                                    onClick={() =>
                                      setSelectedPost({
                                        post,
                                        followerUsername: follower.username,
                                        scrapedAt,
                                      })
                                    }
                                    className="relative aspect-[4/5] sm:aspect-square bg-slate-900 overflow-hidden cursor-pointer"
                                  >
                                    {post.thumbnailUrl ? (
                                      <img
                                        src={post.thumbnailUrl}
                                        alt={post.captionText || "Repost Instagram"}
                                        referrerPolicy="no-referrer"
                                        loading="lazy"
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                        onError={(e) => {
                                          (e.target as HTMLElement).style.display = "none";
                                          const parent = (e.target as HTMLElement).parentElement;
                                          if (parent) {
                                            parent.classList.add("flex", "items-center", "justify-center");
                                            const fallback = document.createElement("div");
                                            fallback.className = "text-center text-slate-400 p-4 text-xs";
                                            fallback.innerHTML = "<div class='w-8 h-8 mx-auto mb-1 opacity-50 flex items-center justify-center'><svg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><rect width='18' height='18' x='3' y='3' rx='2'/><circle cx='9' cy='9' r='2'/><path d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'/></svg></div><span>Pratinjau media tidak tersedia</span>";
                                            parent.appendChild(fallback);
                                          }
                                        }}
                                      />
                                    ) : (
                                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 p-4 bg-slate-900">
                                        <ImageIcon className="w-8 h-8 text-slate-600 mb-1" />
                                        <span className="text-[11px] text-slate-400">
                                          Tidak ada gambar thumbnail
                                        </span>
                                      </div>
                                    )}

                                    {/* Dual Gradient Scrim for Contrast */}
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/50 pointer-events-none" />

                                    {/* Central Play Button Overlay for Videos */}
                                    {isVideo && (
                                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <div className="w-13 h-13 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center shadow-xl border border-white/25 group-hover:scale-110 group-hover:bg-amber-600 transition-all duration-300">
                                          <Play className="w-6 h-6 fill-white ml-0.5" />
                                        </div>
                                      </div>
                                    )}

                                    {/* Top Left: Format Badge */}
                                    <div className="absolute top-3 left-3 z-10">
                                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-black/60 backdrop-blur-md text-white border border-white/15 shadow-sm">
                                        {isVideo && (
                                          <>
                                            <Play className="w-3 h-3 fill-white" />
                                            Reels / Video
                                          </>
                                        )}
                                        {post.mediaType === "Sidecar" && (
                                          <>
                                            <Layers className="w-3 h-3" />
                                            Carousel
                                          </>
                                        )}
                                        {!isVideo && post.mediaType !== "Sidecar" && (
                                          <>
                                            <ImageIcon className="w-3 h-3" />
                                            Foto
                                          </>
                                        )}
                                      </span>
                                    </div>

                                    {/* Top Right: Metrics (Likes / Plays) */}
                                    <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
                                      {post.playCount != null && post.playCount > 0 && (
                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-black/60 backdrop-blur-md text-white border border-white/15">
                                          <Play className="w-2.5 h-2.5 fill-white" />
                                          {post.playCount.toLocaleString("id-ID")}
                                        </span>
                                      )}
                                      {post.likeCount != null && post.likeCount > 0 && (
                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-black/60 backdrop-blur-md text-white border border-white/15">
                                          <Heart className="w-2.5 h-2.5 text-rose-400 fill-rose-400" />
                                          {post.likeCount.toLocaleString("id-ID")}
                                        </span>
                                      )}
                                    </div>

                                    {/* Bottom Overlay: Creator & Date on Image */}
                                    <div className="absolute bottom-3 left-3 right-3 z-10 flex items-end justify-between gap-2">
                                      <div>
                                        <span className="text-[10px] text-slate-300 font-medium block uppercase tracking-wider">
                                          Kreator Asal
                                        </span>
                                        {post.ownerUsername ? (
                                          <a
                                            href={`https://instagram.com/${post.ownerUsername}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            className="text-sm font-black text-white hover:text-amber-400 transition drop-shadow-sm flex items-center gap-1"
                                            title="Buka profil pembuat asli"
                                          >
                                            @{post.ownerUsername}
                                          </a>
                                        ) : (
                                          <span className="text-xs text-slate-400">Tidak diketahui</span>
                                        )}
                                      </div>

                                      {/* Quick Inspect Button */}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedPost({
                                            post,
                                            followerUsername: follower.username,
                                            scrapedAt,
                                          });
                                        }}
                                        className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/40 backdrop-blur-md text-white flex items-center justify-center transition"
                                        title="Pratinjau detail postingan"
                                      >
                                        <Maximize2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>

                                  {/* Card Body */}
                                  <div className="p-4 sm:p-4.5">
                                    {/* Release date row */}
                                    <div className="flex items-center justify-between text-xs text-slate-500 mb-2.5 pb-2 border-b border-slate-100">
                                      <span className="inline-flex items-center gap-1 text-[11px]">
                                        <Calendar className="w-3 h-3 text-slate-400" />
                                        {post.takenAt
                                          ? new Date(post.takenAt).toLocaleDateString("id-ID", {
                                              day: "numeric",
                                              month: "short",
                                              year: "numeric",
                                            })
                                          : "Tanggal tidak tersedia"}
                                      </span>

                                      <span className="text-[10px] text-slate-400">
                                        ID: {post.code || post.id.slice(0, 10)}
                                      </span>
                                    </div>

                                    {/* Caption */}
                                    {post.captionText ? (
                                      <div className="mb-3">
                                        <p
                                          className={`text-xs text-slate-700 leading-relaxed whitespace-pre-line ${
                                            !isCaptionExpanded && isLongCaption ? "line-clamp-3" : ""
                                          }`}
                                        >
                                          {post.captionText}
                                        </p>
                                        {isLongCaption && (
                                          <button
                                            onClick={() => toggleCaption(post.id)}
                                            className="text-[11px] font-bold text-amber-600 hover:text-amber-700 mt-1 transition"
                                          >
                                            {isCaptionExpanded ? "Sembunyikan" : "Lihat selengkapnya..."}
                                          </button>
                                        )}
                                      </div>
                                    ) : (
                                      <p className="text-xs text-slate-400 italic mb-3">
                                        Postingan tanpa caption teks.
                                      </p>
                                    )}

                                    {/* Hashtag Chips */}
                                    {post.hashtags && post.hashtags.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mb-3">
                                        {post.hashtags.slice(0, 4).map((tag) => (
                                          <button
                                            key={tag}
                                            onClick={() => {
                                              setContentSearch(tag);
                                              setPage(1);
                                            }}
                                            className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-md bg-slate-100 hover:bg-amber-50 hover:text-amber-800 text-slate-600 font-medium transition"
                                          >
                                            #{tag}
                                          </button>
                                        ))}
                                        {post.hashtags.length > 4 && (
                                          <span className="text-[10px] text-slate-400 self-center">
                                            +{post.hashtags.length - 4}
                                          </span>
                                        )}
                                      </div>
                                    )}

                                    {/* AI Visual Description Box */}
                                    {post.visualDescription && (
                                      <div className="mt-3 p-3 rounded-xl bg-amber-50/60 border border-amber-200/70 text-xs">
                                        <div className="flex items-center gap-1.5 text-amber-900 font-bold mb-1 text-[11px]">
                                          <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                                          Analisis Visual AI:
                                        </div>
                                        <p className="text-[11px] text-amber-950/85 leading-relaxed line-clamp-3">
                                          {post.visualDescription}
                                        </p>
                                        <button
                                          onClick={() =>
                                            setSelectedPost({
                                              post,
                                              followerUsername: follower.username,
                                              scrapedAt,
                                            })
                                          }
                                          className="text-[10px] text-amber-700 hover:underline font-semibold mt-1 inline-block"
                                        >
                                          Baca deskripsi visual lengkap
                                        </button>
                                      </div>
                                    )}

                                    {post.visualDescriptionStatus === "pending" && (
                                      <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-[10px] text-slate-600 font-medium">
                                        <Clock className="w-3 h-3 text-slate-400" />
                                        Menunggu antrean visi AI
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Card Footer Actions */}
                                <div className="p-4 pt-0">
                                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                                    <button
                                      onClick={() => handleCopyLink(post.code)}
                                      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 transition"
                                      title="Salin tautan Instagram"
                                    >
                                      {copiedCode === post.code ? (
                                        <>
                                          <Check className="w-3 h-3 text-emerald-600" />
                                          <span className="text-emerald-600 font-bold">Disalin!</span>
                                        </>
                                      ) : (
                                        <>
                                          <Share2 className="w-3 h-3" />
                                          Bagikan
                                        </>
                                      )}
                                    </button>

                                    <div className="flex items-center gap-2">
                                      {isVideo && (
                                        <button
                                          onClick={() =>
                                            setSelectedPost({
                                              post,
                                              followerUsername: follower.username,
                                              scrapedAt,
                                            })
                                          }
                                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                                        >
                                          <Play className="w-3 h-3 fill-slate-700" />
                                          Putar
                                        </button>
                                      )}

                                      {post.code ? (
                                        <a
                                          href={`https://instagram.com/p/${post.code}`}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100/80 rounded-lg transition border border-amber-200/60"
                                        >
                                          Instagram
                                          <ExternalLink className="w-3 h-3" />
                                        </a>
                                      ) : (
                                        <span className="text-[10px] text-slate-300">Link tidak ada</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Pagination Controls */}
            {data.pagination.totalPages > 1 && (
              <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-600 shadow-sm mt-8">
                <div>
                  Menampilkan halaman <strong>{data.pagination.page}</strong> dari{" "}
                  <strong>{data.pagination.totalPages}</strong> (Total{" "}
                  <strong>{data.pagination.totalFollowers}</strong> akun follower)
                </div>

                <div className="flex items-center gap-2">
                  <button
                    disabled={data.pagination.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-3.5 py-1.5 border border-slate-300 rounded-xl hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
                  >
                    Sebelumnya
                  </button>

                  <div className="flex items-center gap-1">
                    {Array.from(
                      { length: Math.min(5, data.pagination.totalPages) },
                      (_, i) => {
                        const pageNum = i + 1;
                        return (
                          <button
                            key={pageNum}
                            onClick={() => setPage(pageNum)}
                            className={`w-8 h-8 rounded-xl font-bold transition ${
                              data.pagination.page === pageNum
                                ? "bg-slate-900 text-white shadow-sm"
                                : "border border-slate-200 hover:bg-slate-50 text-slate-700"
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      }
                    )}
                    {data.pagination.totalPages > 5 && (
                      <span className="px-1 text-slate-400">...</span>
                    )}
                  </div>

                  <button
                    disabled={data.pagination.page >= data.pagination.totalPages}
                    onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
                    className="px-3.5 py-1.5 border border-slate-300 rounded-xl hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
                  >
                    Selanjutnya
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Post Detail Inspection Modal with Live Video Playback */}
      {selectedPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col md:flex-row relative animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setSelectedPost(null)}
              className="absolute top-4 right-4 z-30 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition shadow-lg"
              title="Tutup dialog"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Left Media Area: Video Player or Image */}
            <div className="w-full md:w-1/2 bg-slate-950 flex items-center justify-center relative overflow-hidden min-h-[300px] md:min-h-[520px]">
              {(selectedPost.post.mediaType === "Video" || selectedPost.post.videoUrl) &&
              selectedPost.post.videoUrl ? (
                <div className="w-full h-full flex flex-col items-center justify-center p-2 bg-black">
                  <video
                    src={selectedPost.post.videoUrl}
                    poster={selectedPost.post.thumbnailUrl || undefined}
                    controls
                    autoPlay
                    playsInline
                    preload="auto"
                    {...({ referrerPolicy: "no-referrer" } as Record<string, unknown>)}
                    className="w-full max-h-[500px] object-contain rounded-xl shadow-2xl"
                    onError={(e) => {
                      const v = e.currentTarget;
                      v.style.display = "none";
                      const fallback = v.nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = "flex";
                    }}
                  >
                    Browser Anda tidak mendukung pemutar video HTML5.
                  </video>

                  {/* Fallback if CDN video link is expired/blocked */}
                  <div
                    style={{ display: "none" }}
                    className="flex-col items-center justify-center text-center p-6 text-slate-300"
                  >
                    <Play className="w-10 h-10 text-amber-500 mb-2 opacity-80" />
                    <p className="text-xs font-bold mb-1">
                      Video tidak dapat diputar langsung dari CDN Instagram
                    </p>
                    <p className="text-[11px] text-slate-400 mb-3 max-w-xs">
                      Tautan video dari Instagram mungkin telah kedaluwarsa atau dibatasi oleh server Instagram.
                    </p>
                    {selectedPost.post.code && (
                      <a
                        href={`https://instagram.com/p/${selectedPost.post.code}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition shadow-sm"
                      >
                        Buka Video di Instagram
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              ) : selectedPost.post.thumbnailUrl ? (
                <img
                  src={selectedPost.post.thumbnailUrl}
                  alt={selectedPost.post.captionText || "Detail postingan"}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-contain max-h-[500px]"
                />
              ) : (
                <div className="text-center text-slate-400 p-8">
                  <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-40" />
                  <p className="text-xs">Gambar media tidak tersedia</p>
                </div>
              )}

              <div className="absolute bottom-3 left-3 z-10 pointer-events-none">
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-black/70 backdrop-blur-md text-white border border-white/20">
                  {selectedPost.post.mediaType === "Video" || selectedPost.post.videoUrl
                    ? "Video / Reels"
                    : selectedPost.post.mediaType === "Sidecar"
                    ? "Carousel"
                    : "Foto"}
                </span>
              </div>
            </div>

            {/* Right Details Panel */}
            <div className="w-full md:w-1/2 p-6 flex flex-col justify-between overflow-y-auto max-h-[60vh] md:max-h-[90vh]">
              <div>
                {/* Header: Follower who reposted & Original Creator */}
                <div className="pb-4 mb-4 border-b border-slate-100">
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                    <span>Ditemukan dari Follower:</span>
                    <span className="font-semibold text-slate-700">
                      @{selectedPost.followerUsername}
                    </span>
                  </div>

                  <div className="flex items-center justify-between mt-2">
                    <div>
                      <span className="text-[10px] text-slate-400 block uppercase font-bold">
                        Kreator Asal
                      </span>
                      {selectedPost.post.ownerUsername ? (
                        <a
                          href={`https://instagram.com/${selectedPost.post.ownerUsername}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-base font-black text-slate-900 hover:text-amber-600 transition flex items-center gap-1.5"
                        >
                          @{selectedPost.post.ownerUsername}
                          <ExternalLink className="w-4 h-4 text-slate-400" />
                        </a>
                      ) : (
                        <span className="text-sm text-slate-500">Tidak diketahui</span>
                      )}
                    </div>

                    {selectedPost.post.takenAt && (
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 block uppercase font-bold">
                          Tanggal Rilis
                        </span>
                        <span className="text-xs text-slate-700 font-semibold">
                          {new Date(selectedPost.post.takenAt).toLocaleDateString("id-ID", {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Metrics bar */}
                  <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100">
                    {selectedPost.post.playCount != null && selectedPost.post.playCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-600 font-semibold">
                        <Play className="w-3.5 h-3.5 text-indigo-500 fill-indigo-500" />
                        {selectedPost.post.playCount.toLocaleString("id-ID")} Tayangan
                      </span>
                    )}
                    {selectedPost.post.likeCount != null && selectedPost.post.likeCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-600 font-semibold">
                        <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
                        {selectedPost.post.likeCount.toLocaleString("id-ID")} Suka
                      </span>
                    )}
                  </div>
                </div>

                {/* Caption full */}
                <div className="mb-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Teks Caption Lengkap
                  </h4>
                  {selectedPost.post.captionText ? (
                    <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-line bg-slate-50 p-3 rounded-xl border border-slate-200/60 max-h-44 overflow-y-auto">
                      {selectedPost.post.captionText}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400 italic">Tidak ada caption.</p>
                  )}
                </div>

                {/* Hashtags */}
                {selectedPost.post.hashtags && selectedPost.post.hashtags.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Tagar Terdeteksi
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedPost.post.hashtags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[11px] px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200/70 font-medium"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI Visual Description */}
                {selectedPost.post.visualDescription && (
                  <div className="mb-4 p-3.5 rounded-2xl bg-amber-50/80 border border-amber-200">
                    <div className="flex items-center gap-1.5 text-amber-900 font-bold text-xs mb-1.5">
                      <Sparkles className="w-4 h-4 text-amber-600" />
                      Analisis Visual AI (OpenRouter Vision)
                    </div>
                    <p className="text-xs text-amber-950/90 leading-relaxed">
                      {selectedPost.post.visualDescription}
                    </p>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                <button
                  onClick={() => handleCopyLink(selectedPost.post.code)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1.5"
                >
                  {copiedCode === selectedPost.post.code ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Tautan Disalin</span>
                    </>
                  ) : (
                    <>
                      <Share2 className="w-3.5 h-3.5" />
                      <span>Salin Tautan</span>
                    </>
                  )}
                </button>

                {selectedPost.post.code && (
                  <a
                    href={`https://instagram.com/p/${selectedPost.post.code}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition flex items-center gap-2 shadow-md shadow-amber-600/20"
                  >
                    Buka di Instagram
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
