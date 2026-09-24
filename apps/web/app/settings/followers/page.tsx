"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  UploadCloud,
  FileCheck2,
  AlertCircle,
  RefreshCw,
  Users,
  Clock,
  CheckCircle2,
  XCircle,
  Play,
  Pause,
  ArrowLeft,
} from "lucide-react";

interface StatusSummary {
  pending: number;
  in_progress: number;
  done: number;
  failed: number;
  total: number;
}

interface FollowerItem {
  username: string;
  status: "pending" | "in_progress" | "done" | "failed";
  apifyRunId: string | null;
  lastScrapedAt: string | null;
  retryCount: number;
  createdAt: string;
}

interface ImportSummary {
  totalInFile: number;
  newFollowers: number;
  alreadyExisting: number;
}

export default function FollowersSettingsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    message?: string;
    summary?: ImportSummary;
    error?: string;
  } | null>(null);

  const [summary, setSummary] = useState<StatusSummary>({
    pending: 0,
    in_progress: 0,
    done: 0,
    failed: 0,
    total: 0,
  });
  const [followers, setFollowers] = useState<FollowerItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [control, setControl] = useState<{
    isPaused: boolean;
    pauseReason: string | null;
    maxConcurrency: number;
  }>({
    isPaused: false,
    pauseReason: null,
    maxConcurrency: 3,
  });
  const [togglingControl, setTogglingControl] = useState(false);

  const fetchControl = async () => {
    try {
      const res = await fetch("/api/scrape-control");
      if (res.ok) {
        const data = await res.json();
        if (data.control) setControl(data.control);
      }
    } catch (err) {
      console.error("Gagal memuat scrape control:", err);
    }
  };

  const toggleScrapeControl = async () => {
    setTogglingControl(true);
    try {
      const endpoint = control.isPaused ? "/api/scrape-control/resume" : "/api/scrape-control/pause";
      const res = await fetch(endpoint, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.control) setControl(data.control);
      }
    } catch (err) {
      console.error("Gagal toggle scrape control:", err);
    } finally {
      setTogglingControl(false);
    }
  };

  const fetchSummaryAndList = async () => {
    setLoadingList(true);
    fetchControl();
    try {
      const url = new URL("/api/followers", window.location.origin);
      if (filterStatus) url.searchParams.set("status", filterStatus);
      url.searchParams.set("page", page.toString());
      url.searchParams.set("limit", "20");

      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary || summary);
        setFollowers(data.followers || []);
        if (data.pagination) {
          setTotalPages(data.pagination.totalPages || 1);
        }
      }
    } catch (err) {
      console.error("Gagal memuat followers:", err);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    fetchSummaryAndList();
    const interval = setInterval(fetchControl, 10000);
    return () => clearInterval(interval);
  }, [filterStatus, page]);

  const handleRetry = async (username: string) => {
    try {
      const res = await fetch(`/api/followers/${encodeURIComponent(username)}/retry`, {
        method: "POST",
      });
      if (res.ok) {
        fetchSummaryAndList();
      }
    } catch (err) {
      console.error("Gagal me-retry follower:", err);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setUploadResult(null);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setUploading(true);
    setUploadResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/followers/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setUploadResult({
          success: false,
          error: data.error || "Gagal mengimpor file.",
        });
      } else {
        setUploadResult({
          success: true,
          message: data.message,
          summary: data.summary,
        });
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        fetchSummaryAndList();
      }
    } catch (err) {
      setUploadResult({
        success: false,
        error: "Terjadi gangguan jaringan atau server saat upload.",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-slate-200 gap-4">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 mb-2 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Kembali ke Beranda
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">
            Manajemen Followers & Import
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Unggah file <code className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded text-xs">followers.json</code> hasil export Instagram @ynsurabaya.
          </p>
        </div>

        <button
          onClick={fetchSummaryAndList}
          className="inline-flex items-center gap-2 self-start md:self-auto px-4 py-2 text-sm font-medium bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-slate-700 transition"
        >
          <RefreshCw className={`w-4 h-4 ${loadingList ? "animate-spin" : ""}`} />
          Segarkan Data
        </button>
      </div>

      {/* Scrape Engine Control Card */}
      <div className={`mt-6 p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition shadow-sm ${
        control.isPaused
          ? "bg-amber-50/70 border-amber-200"
          : "bg-emerald-50/70 border-emerald-200"
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${
            control.isPaused ? "bg-amber-500 animate-pulse" : "bg-emerald-500 animate-ping"
          }`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Status Mesin Scraping:</span>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                control.isPaused
                  ? "bg-amber-100 text-amber-900 border border-amber-300"
                  : "bg-emerald-100 text-emerald-900 border border-emerald-300"
              }`}>
                {control.isPaused ? "DIJEDA (PAUSED)" : "AKTIF BERJALAN (RUNNING)"}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {control.isPaused
                ? control.pauseReason
                  ? `Alasan jeda: ${control.pauseReason}`
                  : "Scraping dihentikan sementara. Run yang sudah berjalan akan diselesaikan."
                : `Mesin scraping aktif dengan konkurensi ${control.maxConcurrency} worker bersamaan.`}
            </p>
          </div>
        </div>

        <button
          onClick={toggleScrapeControl}
          disabled={togglingControl}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition shadow-sm ${
            control.isPaused
              ? "bg-emerald-600 hover:bg-emerald-700 text-white"
              : "bg-amber-600 hover:bg-amber-700 text-white"
          } disabled:opacity-50`}
        >
          {togglingControl ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : control.isPaused ? (
            <Play className="w-3.5 h-3.5 fill-current" />
          ) : (
            <Pause className="w-3.5 h-3.5 fill-current" />
          )}
          {control.isPaused ? "Lanjutkan Scraping (Resume)" : "Jeda Scraping (Pause)"}
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 my-6">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium">Total Terdaftar</span>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
          <p className="text-2xl font-bold text-slate-900">{summary.total.toLocaleString("id-ID")}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium text-amber-700">Antrean (Pending)</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-amber-600">{summary.pending.toLocaleString("id-ID")}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium text-blue-700">Sedang Discrape</span>
            <RefreshCw className="w-4 h-4 text-blue-500" />
          </div>
          <p className="text-2xl font-bold text-blue-600">{summary.in_progress.toLocaleString("id-ID")}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium text-emerald-700">Selesai (Done)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-emerald-600">{summary.done.toLocaleString("id-ID")}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm col-span-2 md:col-span-1">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium text-rose-700">Gagal (Failed)</span>
            <XCircle className="w-4 h-4 text-rose-500" />
          </div>
          <p className="text-2xl font-bold text-rose-600">{summary.failed.toLocaleString("id-ID")}</p>
        </div>
      </div>

      {/* Upload Box */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-2 flex items-center gap-2">
          <UploadCloud className="w-5 h-5 text-amber-600" />
          Import File Followers (Find-or-Create)
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          Mendukung format resmi export Instagram (struktur <code>string_list_data[].value</code>). Follower yang sudah pernah diimpor tidak akan direset status progres scraping-nya.
        </p>

        <form onSubmit={handleUpload} className="flex flex-col md:flex-row gap-4 items-start md:items-center">
          <div className="flex-1 w-full">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileChange}
              className="block w-full text-sm text-slate-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-900 file:text-white hover:file:bg-slate-800 cursor-pointer border border-slate-200 rounded-lg p-1 bg-slate-50"
            />
          </div>
          <button
            type="submit"
            disabled={!file || uploading}
            className={`w-full md:w-auto px-6 py-2.5 rounded-lg text-sm font-semibold transition inline-flex items-center justify-center gap-2 ${
              uploading || !file
                ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                : "bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
            }`}
          >
            {uploading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Memproses File...
              </>
            ) : (
              <>
                <FileCheck2 className="w-4 h-4" />
                Mulai Import
              </>
            )}
          </button>
        </form>

        {uploadResult && (
          <div
            className={`mt-4 p-4 rounded-xl border text-sm flex items-start gap-3 ${
              uploadResult.success
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-rose-50 border-rose-200 text-rose-900"
            }`}
          >
            {uploadResult.success ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 mt-0.5 flex-shrink-0" />
            )}
            <div>
              <p className="font-semibold">{uploadResult.success ? "Import Berhasil!" : "Gagal Mengimpor"}</p>
              <p className="mt-0.5 text-xs opacity-90">{uploadResult.message || uploadResult.error}</p>
              {uploadResult.summary && (
                <div className="mt-2 text-xs flex gap-4 bg-white/60 p-2 rounded-lg border border-emerald-200/50">
                  <span>Total file: <strong>{uploadResult.summary.totalInFile}</strong></span>
                  <span>Baru: <strong>+{uploadResult.summary.newFollowers}</strong></span>
                  <span>Sudah ada (dilewati): <strong>{uploadResult.summary.alreadyExisting}</strong></span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Followers Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
          <div>
            <h3 className="font-semibold text-slate-900 text-sm">Daftar Follower</h3>
            <p className="text-xs text-slate-500">Menampilkan follower dan status pengerjaan Apify</p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Filter:</span>
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setPage(1);
              }}
              className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-slate-700"
            >
              <option value="">Semua Status</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Username</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Apify Run ID</th>
                <th className="py-3 px-4">Percobaan (Retry)</th>
                <th className="py-3 px-4">Terakhir Di-scrape</th>
                <th className="py-3 px-4">Tanggal Ditambahkan</th>
                <th className="py-3 px-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingList ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-slate-400" />
                    Memuat daftar follower...
                  </td>
                </tr>
              ) : followers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    Belum ada data follower. Silakan unggah file <code>followers.json</code> di atas.
                  </td>
                </tr>
              ) : (
                followers.map((f) => (
                  <tr key={f.username} className="hover:bg-slate-50 transition">
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      <a
                        href={`https://instagram.com/${f.username}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-amber-600 hover:underline"
                      >
                        @{f.username}
                      </a>
                    </td>
                    <td className="py-3 px-4">
                      {f.status === "pending" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">
                          Pending
                        </span>
                      )}
                      {f.status === "in_progress" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-800">
                          In Progress
                        </span>
                      )}
                      {f.status === "done" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                          Done
                        </span>
                      )}
                      {f.status === "failed" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-800">
                          Failed
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                      {f.apifyRunId || "—"}
                    </td>
                    <td className="py-3 px-4">{f.retryCount}</td>
                    <td className="py-3 px-4">
                      {f.lastScrapedAt
                        ? new Date(f.lastScrapedAt).toLocaleString("id-ID")
                        : "—"}
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {new Date(f.createdAt).toLocaleDateString("id-ID")}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {f.status === "failed" ? (
                        <button
                          onClick={() => handleRetry(f.username)}
                          className="px-2.5 py-1 text-[11px] font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-md transition"
                        >
                          Coba Ulang
                        </button>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 bg-white">
            <span>
              Halaman <strong>{page}</strong> dari <strong>{totalPages}</strong>
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1 border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Sebelumnya
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1 border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Selanjutnya
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
