"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  KeyRound,
  PlusCircle,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowLeft,
  RotateCcw,
  Zap,
  Info,
} from "lucide-react";

interface OpenRouterKeyItem {
  id: number;
  label: string | null;
  maskedToken: string;
  status: "active" | "rate_limited" | "invalid";
  rateLimitedUntil: string | null;
  rateLimitSecondsLeft: number | null;
  lastCheckedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface KeyStats {
  totalActive: number;
  totalRateLimited: number;
  totalInvalid: number;
}

export default function OpenRouterKeysPage() {
  const [keys, setKeys] = useState<OpenRouterKeyItem[]>([]);
  const [stats, setStats] = useState<KeyStats>({ totalActive: 0, totalRateLimited: 0, totalInvalid: 0 });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/openrouter-keys");
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
        setStats({
          totalActive: data.totalActive ?? 0,
          totalRateLimited: data.totalRateLimited ?? 0,
          totalInvalid: data.totalInvalid ?? 0,
        });
      }
    } catch (err) {
      console.error("Gagal memuat OpenRouter keys:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;

    setAdding(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      const res = await fetch("/api/openrouter-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, token }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Gagal menambahkan API key.");
      } else {
        setFormSuccess(data.message);
        setLabel("");
        setToken("");
        fetchKeys();
      }
    } catch {
      setFormError("Terjadi kesalahan jaringan.");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: number, labelStr: string | null) => {
    if (!confirm(`Hapus key "${labelStr || `#${id}`}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      const res = await fetch(`/api/openrouter-keys/${id}`, { method: "DELETE" });
      if (res.ok) fetchKeys();
    } catch (err) {
      console.error("Gagal menghapus key:", err);
    }
  };

  const handleReactivate = async (id: number) => {
    try {
      const res = await fetch(`/api/openrouter-keys/${id}`, { method: "PATCH" });
      if (res.ok) fetchKeys();
    } catch (err) {
      console.error("Gagal reaktivasi key:", err);
    }
  };

  const statusBadge = (k: OpenRouterKeyItem) => {
    if (k.status === "active") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Aktif
        </span>
      );
    }
    if (k.status === "rate_limited") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">
          <Clock className="w-3 h-3 text-amber-600" /> Rate Limited
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-800">
        <XCircle className="w-3 h-3 text-rose-600" /> Invalid
      </span>
    );
  };

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
  };

  const allInactive = keys.length > 0 && stats.totalActive === 0;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-slate-200 gap-4">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 mb-2 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Kembali ke Beranda
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Zap className="w-6 h-6 text-violet-600" />
            Manajemen Multi API-Key OpenRouter
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Kelola rotasi API Key OpenRouter (gratis). Jika satu key kena rate limit 429, sistem otomatis beralih ke key berikutnya.
          </p>
        </div>

        <button
          onClick={fetchKeys}
          className="inline-flex items-center gap-2 self-start md:self-auto px-4 py-2 text-sm font-medium bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-slate-700 transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Segarkan
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mt-6">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-emerald-700">{stats.totalActive}</div>
          <div className="text-xs text-emerald-600 font-medium mt-0.5">Key Aktif</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-amber-700">{stats.totalRateLimited}</div>
          <div className="text-xs text-amber-600 font-medium mt-0.5">Rate Limited</div>
        </div>
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-rose-700">{stats.totalInvalid}</div>
          <div className="text-xs text-rose-600 font-medium mt-0.5">Invalid</div>
        </div>
      </div>

      {/* All inactive alert */}
      {allInactive && (
        <div className="mt-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-3 shadow-sm">
          <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5 flex-shrink-0" />
          <div>
            <h2 className="font-bold text-sm">Seluruh API Key OpenRouter Tidak Aktif</h2>
            <p className="text-xs mt-1 text-rose-800">
              Tidak ada key berstatus aktif. Chat RAG dan semantic search tidak akan berfungsi. Tambahkan key baru atau aktifkan kembali key yang ada.
            </p>
          </div>
        </div>
      )}

      {/* Info cara dapat key */}
      <div className="mt-6 p-4 rounded-xl bg-violet-50 border border-violet-200 flex items-start gap-3">
        <Info className="w-4 h-4 text-violet-600 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-violet-800">
          Daftarkan akun gratis di{" "}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noreferrer"
            className="underline font-semibold"
          >
            openrouter.ai/keys
          </a>{" "}
          untuk mendapatkan API Key. Anda bisa mendaftarkan beberapa akun dengan email berbeda untuk menambah kapasitas round-robin.
        </p>
      </div>

      {/* Add Key Form */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 my-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <PlusCircle className="w-5 h-5 text-violet-600" />
          Tambah API Key OpenRouter Baru
        </h2>
        <form onSubmit={handleAddKey} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Label (Opsional)
              </label>
              <input
                type="text"
                placeholder="Contoh: Akun Gmail 1"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                OpenRouter API Key <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  placeholder="sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  required
                  className="w-full text-xs px-3 py-2 pr-16 font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 hover:text-slate-700 px-1"
                >
                  {showToken ? "Sembunyikan" : "Tampilkan"}
                </button>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={adding || !token.trim()}
              className="px-5 py-2 text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition inline-flex items-center gap-2 disabled:opacity-50"
            >
              {adding ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Memverifikasi...
                </>
              ) : (
                <>
                  <PlusCircle className="w-3.5 h-3.5" />
                  Simpan &amp; Verifikasi Token
                </>
              )}
            </button>
          </div>

          {formError && (
            <p className="text-xs text-rose-600 bg-rose-50 p-2.5 rounded-lg border border-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {formError}
            </p>
          )}
          {formSuccess && (
            <p className="text-xs text-emerald-700 bg-emerald-50 p-2.5 rounded-lg border border-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              {formSuccess}
            </p>
          )}
        </form>
      </div>

      {/* Keys Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div>
            <h3 className="font-semibold text-slate-900 text-sm">Daftar API Key Terdaftar</h3>
            <p className="text-xs text-slate-500">
              Total <strong>{keys.length}</strong> key ({stats.totalActive} aktif)
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Label</th>
                <th className="py-3 px-4">Token (Masked)</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Rate Limit Berakhir</th>
                <th className="py-3 px-4">Terakhir Dipakai</th>
                <th className="py-3 px-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-slate-400" />
                    Memuat API keys...
                  </td>
                </tr>
              ) : keys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    Belum ada API Key OpenRouter yang didaftarkan. Masukkan token Anda di atas.
                  </td>
                </tr>
              ) : (
                keys.map((k) => (
                  <tr key={k.id} className="hover:bg-slate-50 transition">
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {k.label || `Key #${k.id}`}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                      {k.maskedToken}
                    </td>
                    <td className="py-3 px-4">{statusBadge(k)}</td>
                    <td className="py-3 px-4 text-slate-500">
                      {k.status === "rate_limited" && k.rateLimitedUntil ? (
                        <span className="text-amber-700 font-medium">
                          {formatDate(k.rateLimitedUntil)}
                          {k.rateLimitSecondsLeft && k.rateLimitSecondsLeft > 0 && (
                            <span className="ml-1 text-slate-400">
                              ({k.rateLimitSecondsLeft}s lagi)
                            </span>
                          )}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {k.lastUsedAt ? formatDate(k.lastUsedAt) : "Belum pernah"}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-1">
                        {/* Reaktivasi manual (untuk rate_limited/invalid) */}
                        {k.status !== "active" && (
                          <button
                            onClick={() => handleReactivate(k.id)}
                            className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition"
                            title="Aktifkan kembali"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(k.id, k.label)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                          title="Hapus Key"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Round-robin explanation */}
      <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-200">
        <h3 className="text-xs font-bold text-slate-800 mb-2 flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 text-slate-600" />
          Cara Kerja Round-Robin
        </h3>
        <ul className="text-xs text-slate-600 space-y-1 list-disc list-inside">
          <li>Setiap request ke OpenRouter menggunakan key yang paling lama tidak dipakai (LRU).</li>
          <li>Jika key kena <strong>rate limit (HTTP 429)</strong>, key tersebut ditandai <em>rate_limited</em> dan sistem langsung beralih ke key berikutnya.</li>
          <li>Key yang rate limited akan aktif kembali <strong>otomatis</strong> setelah window rate limit habis (berdasarkan header <code>Retry-After</code>).</li>
          <li>Jika key dikembalikan <strong>invalid (HTTP 401/403)</strong>, key ditandai <em>invalid</em> dan perlu dihapus atau diaktifkan ulang manual.</li>
          <li>Jika tidak ada key di tabel ini, sistem fallback ke <code>OPENROUTER_API_KEY</code> di file <code>.env</code>.</li>
        </ul>
      </div>
    </div>
  );
}
