"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  MessageSquare,
  Send,
  Trash2,
  RefreshCw,
  Sparkles,
  Bot,
  User,
  ArrowLeft,
  BarChart3,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChartData {
  isChart: boolean;
  chartType: "bar" | "line" | "area";
  title: string;
  data: { name: string; value: number }[];
}

interface MessageItem {
  id?: number;
  role: "user" | "assistant" | "system";
  content: string;
  chart?: ChartData | null;
  toolCalls?: any;
  createdAt?: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/chat/history");
      if (res.ok) {
        const json = await res.json();
        // Parse any charts stored in toolCalls
        const mapped = (json.messages || []).map((m: any) => {
          let chart: ChartData | null = null;
          if (Array.isArray(m.toolCalls)) {
            const chartCall = m.toolCalls.find((tc: any) => tc.name === "render_chart");
            if (chartCall?.result?.isChart) {
              chart = chartCall.result;
            }
          }
          return {
            id: m.id,
            role: m.role,
            content: m.content,
            chart,
            createdAt: m.createdAt,
          };
        });
        setMessages(mapped);
      }
    } catch (err) {
      console.error("Gagal memuat riwayat:", err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const handleSend = async (e?: React.FormEvent, customPrompt?: string) => {
    if (e) e.preventDefault();
    const promptToSend = customPrompt || input;
    if (!promptToSend.trim() || sending) return;

    const userMsg: MessageItem = { role: "user", content: promptToSend };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: promptToSend }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.reply,
            chart: data.chart,
            toolCalls: data.toolCalls,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Maaf, terjadi kesalahan: ${data.error || "Gagal memproses pesan."}`,
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Gangguan koneksi saat menghubungi server chat.",
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleClearHistory = async () => {
    if (!confirm("Hapus seluruh riwayat percakapan?")) return;
    try {
      await fetch("/api/chat/history", { method: "DELETE" });
      setMessages([]);
    } catch (err) {
      console.error("Gagal menghapus riwayat:", err);
    }
  };

  const samplePrompts = [
    "Siapa saja 5 akun yang paling sering di-repost oleh follower?",
    "Tampilkan grafik bar untuk 5 hashtag terpopuler",
    "Cari repost yang membahas topik sedekah, parenting, atau keluarga",
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col h-[calc(100vh-2rem)]">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 mb-1 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Beranda
          </Link>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Bot className="w-5 h-5 text-amber-600" />
            Asisten Analitik RAG RepostInsight
          </h1>
          <p className="text-xs text-slate-500">
            Tanya jawab konten repost kualitatif (pgvector) & statistik agregat berbasis OpenRouter LLM.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchHistory}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
            title="Segarkan Riwayat"
          >
            <RefreshCw className={`w-4 h-4 ${loadingHistory ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={handleClearHistory}
            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
            title="Bersihkan Percakapan"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto py-6 space-y-5">
        {messages.length === 0 && !loadingHistory ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <Sparkles className="w-10 h-10 text-amber-500 mb-3" />
            <h2 className="text-base font-semibold text-slate-700">Mulai Percakapan Analitik</h2>
            <p className="text-xs text-slate-500 max-w-md mt-1 mb-6">
              Ajukan pertanyaan kualitatif untuk mencari narasi repost, pertanyaan statistik agregat, atau minta grafik visual secara langsung.
            </p>
            <div className="w-full max-w-md space-y-2">
              <span className="text-[11px] font-semibold uppercase text-slate-400 block tracking-wider">
                Contoh Pertanyaan Cepat:
              </span>
              {samplePrompts.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(undefined, p)}
                  className="w-full text-left text-xs p-3 bg-white hover:bg-amber-50/60 border border-slate-200 hover:border-amber-200 rounded-xl transition text-slate-700 shadow-sm"
                >
                  &ldquo;{p}&rdquo;
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div
              key={index}
              className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role !== "user" && (
                <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div
                className={`max-w-[85%] rounded-2xl p-4 text-xs leading-relaxed shadow-sm ${
                  msg.role === "user"
                    ? "bg-slate-900 text-white rounded-br-none"
                    : "bg-white border border-slate-200 text-slate-800 rounded-bl-none"
                }`}
              >
                {msg.role === "user" ? (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                ) : (
                  <div className="prose prose-sm prose-slate max-w-none prose-table:text-xs prose-th:px-2 prose-td:px-2 prose-p:my-1.5 prose-headings:my-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                )}

                {/* Render Chart Inline if present (FR-6.4) */}
                {msg.chart && msg.chart.data && msg.chart.data.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <div className="flex items-center gap-1.5 font-bold text-slate-900 mb-2">
                      <BarChart3 className="w-4 h-4 text-amber-600" />
                      {msg.chart.title}
                    </div>
                    <div className="h-56 w-full pt-2">
                      <ResponsiveContainer width="100%" height="100%">
                        {msg.chart.chartType === "line" ? (
                          <LineChart data={msg.chart.data}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="name" fontSize={10} stroke="#94a3b8" />
                            <YAxis fontSize={10} stroke="#94a3b8" />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "#0f172a",
                                color: "#fff",
                                fontSize: "11px",
                                borderRadius: "6px",
                              }}
                            />
                            <Line type="monotone" dataKey="value" stroke="#e05328" strokeWidth={2} />
                          </LineChart>
                        ) : msg.chart.chartType === "area" ? (
                          <AreaChart data={msg.chart.data}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="name" fontSize={10} stroke="#94a3b8" />
                            <YAxis fontSize={10} stroke="#94a3b8" />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "#0f172a",
                                color: "#fff",
                                fontSize: "11px",
                                borderRadius: "6px",
                              }}
                            />
                            <Area type="monotone" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} />
                          </AreaChart>
                        ) : (
                          <BarChart data={msg.chart.data}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="name" fontSize={10} stroke="#94a3b8" />
                            <YAxis fontSize={10} stroke="#94a3b8" />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "#0f172a",
                                color: "#fff",
                                fontSize: "11px",
                                borderRadius: "6px",
                              }}
                            />
                            <Bar dataKey="value" fill="#e05328" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>

              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))
        )}

        {sending && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-none p-3.5 shadow-sm flex items-center gap-2 text-xs text-slate-500">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-600" />
              <span>Memproses analisis & mencari data...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <form onSubmit={handleSend} className="pt-3 border-t border-slate-200">
        <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-slate-300 shadow-sm focus-within:ring-2 focus-within:ring-amber-500 focus-within:border-transparent">
          <input
            type="text"
            placeholder="Tanyakan analisis repost, akun teratas, topik kajian, atau minta grafik..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
            className="flex-1 text-xs px-3 py-2 bg-transparent focus:outline-none text-slate-800 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold transition inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Kirim</span>
          </button>
        </div>
      </form>
    </div>
  );
}
