"use client";

import React, { useState, useEffect } from "react";
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
  DollarSign,
  ArrowLeft,
  ShieldAlert,
} from "lucide-react";

interface ApifyKeyItem {
  id: number;
  label: string | null;
  maskedToken: string;
  status: "active" | "exhausted" | "invalid";
  monthlyUsageUsd: number;
  maxMonthlyUsageUsd: number;
  usageCycleEndsAt: string | null;
  lastCheckedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export default function ApifyKeysSettingsPage() {
  const [keys, setKeys] = useState<ApifyKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");

  const fetchKeys = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/apify-keys");
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
      }
    } catch (err) {
      console.error("Gagal memuat API keys:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;

    setAdding(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      const res = await fetch("/api/apify-keys", {
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
    } catch (err) {
      setFormError("Terjadi kesalahan jaringan.");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(`Hapus API Key #${id}?`)) return;

    try {
      const res = await fetch(`/api/apify-keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchKeys();
      }
    } catch (err) {
      console.error("Gagal menghapus key:", err);
    }
  };

  const activeKeysCount = keys.filter((k) => k.status === "active").length;

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
            <KeyRound className="w-6 h-6 text-amber-600" />
            Manajemen Multi API-Key Apify
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Kelola rotasi token Apify gratis untuk bypass limit concurrent & kuota bulanan otomatis.
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

      {/* No Active Keys Alert (FR-3.7) */}
      {keys.length > 0 && activeKeysCount === 0 && (
        <div className="mt-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-3 shadow-sm">
          <ShieldAlert className="w-5 h-5 text-rose-600 mt-0.5 flex-shrink-0" />
          <div>
            <h2 className="font-bold text-sm">Seluruh API Key Apify Non-Aktif (Sistem Dijeda Otomatis)</h2>
            <p className="text-xs mt-1 text-rose-800">
              Tidak ada key berstatus aktif yang tersisa. Seluruh proses scraping saat ini dijeda (paused). Silakan tambahkan key Apify baru di bawah ini untuk melanjutkan scraping secara otomatis.
            </p>
          </div>
        </div>
      )}

      {/* Add Key Form */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 my-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <PlusCircle className="w-5 h-5 text-amber-600" />
          Tambah API Key Apify Baru
        </h2>
        <form onSubmit={handleAddKey} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Label Akun (Opsional)
              </label>
              <input
                type="text"
                placeholder="Contoh: Akun Pribadi 1"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Apify Personal API Token <span className="text-rose-500">*</span>
              </label>
              <input
                type="password"
                placeholder="apify_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                className="w-full text-xs px-3 py-2 font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={adding || !token.trim()}
              className="px-5 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition inline-flex items-center gap-2 disabled:opacity-50"
            >
              {adding ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Memverifikasi ke Apify...
                </>
              ) : (
                <>
                  <PlusCircle className="w-3.5 h-3.5" />
                  Simpan & Verifikasi Token
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

      {/* Keys List Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div>
            <h3 className="font-semibold text-slate-900 text-sm">Daftar API Key Terdaftar</h3>
            <p className="text-xs text-slate-500">
              Total <strong>{keys.length}</strong> key ({activeKeysCount} aktif)
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
                <th className="py-3 px-4">Pemakaian Bulanan</th>
                <th className="py-3 px-4">Siklus Reset</th>
                <th className="py-3 px-4">Terakhir Dipakai</th>
                <th className="py-3 px-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-slate-400" />
                    Memuat API keys...
                  </td>
                </tr>
              ) : keys.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    Belum ada API Key Apify yang didaftarkan. Masukkan token Anda di atas.
                  </td>
                </tr>
              ) : (
                keys.map((k) => {
                  const usagePercent =
                    k.maxMonthlyUsageUsd > 0
                      ? Math.min(100, (k.monthlyUsageUsd / k.maxMonthlyUsageUsd) * 100)
                      : 0;

                  return (
                    <tr key={k.id} className="hover:bg-slate-50 transition">
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {k.label || `Key #${k.id}`}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                        {k.maskedToken}
                      </td>
                      <td className="py-3 px-4">
                        {k.status === "active" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Aktif
                          </span>
                        )}
                        {k.status === "exhausted" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">
                            <Clock className="w-3 h-3 text-amber-600" /> Kuota Habis
                          </span>
                        )}
                        {k.status === "invalid" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-800">
                            <XCircle className="w-3 h-3 text-rose-600" /> Invalid
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 min-w-[140px]">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span>${k.monthlyUsageUsd.toFixed(2)}</span>
                          <span className="text-slate-400">/ ${k.maxMonthlyUsageUsd.toFixed(2)}</span>
                        </div>
                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              usagePercent >= 90 ? "bg-rose-500" : usagePercent >= 70 ? "bg-amber-500" : "bg-emerald-500"
                            }`}
                            style={{ width: `${usagePercent}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-500">
                        {k.usageCycleEndsAt ? new Date(k.usageCycleEndsAt).toLocaleDateString("id-ID") : "—"}
                      </td>
                      <td className="py-3 px-4 text-slate-500">
                        {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleTimeString("id-ID") : "Belum pernah"}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => handleDelete(k.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                          title="Hapus Key"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
