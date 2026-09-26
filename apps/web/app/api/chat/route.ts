import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";
import {
  CHATBOT_TOOLS,
  executeSemanticSearch,
  executeQueryAggregate,
  executeAnalyzeTopics,
  executeRenderChart,
} from "@/lib/tools";

export const dynamic = "force-dynamic";

interface ExtractedToolCall {
  id: string;
  name: string;
  args: any;
}

/**
 * Extracts tool calls from either OpenAI native tool_calls
 * OR raw text format (e.g. Cohere/Qwen/Llama XML `<tool_call>...`)
 */
function extractToolCalls(assistantMessage: any): ExtractedToolCall[] {
  const calls: ExtractedToolCall[] = [];

  // 1. Native OpenAI tool calls
  if (assistantMessage?.tool_calls && Array.isArray(assistantMessage.tool_calls)) {
    for (const c of assistantMessage.tool_calls) {
      let args = {};
      try {
        args = typeof c.function?.arguments === "string" 
          ? JSON.parse(c.function.arguments) 
          : c.function?.arguments || {};
      } catch {
        args = {};
      }
      calls.push({
        id: c.id || `call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name: c.function?.name,
        args,
      });
    }
  }

  // 2. Text-based tool calls in content (e.g. Cohere or Qwen XML <tool_call>)
  const content = assistantMessage?.content || "";
  if (typeof content === "string" && content.includes("<tool_call>")) {
    const regex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
    let m;
    while ((m = regex.exec(content)) !== null) {
      const raw = m[1].trim();

      // Check if raw is JSON
      if (raw.startsWith("{") && raw.endsWith("}")) {
        try {
          const parsed = JSON.parse(raw);
          const name = parsed.name || parsed.tool || parsed.function;
          const args = parsed.arguments || parsed.args || parsed;
          if (name) {
            calls.push({
              id: `text_call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              name,
              args: typeof args === "object" ? args : {},
            });
            continue;
          }
        } catch {}
      }

      // Check Cohere format:
      // function_name
      // <arg_key>...</arg_key><arg_value>...</arg_value>
      const fnMatch = raw.match(/^([a-zA-Z0-9_-]+)/);
      const fnName = fnMatch ? fnMatch[1] : "";
      const args: Record<string, any> = {};
      const pairRegex = /<arg_key>([\s\S]*?)<\/arg_key>[\s\S]*?<arg_value>([\s\S]*?)<\/arg_value>/gi;
      let pm;
      while ((pm = pairRegex.exec(raw)) !== null) {
        const k = pm[1].trim();
        let v: any = pm[2].trim();
        if (v === "true") v = true;
        else if (v === "false") v = false;
        else if (!isNaN(Number(v)) && v !== "") v = Number(v);
        else {
          try {
            v = JSON.parse(v);
          } catch {}
        }
        args[k] = v;
      }

      if (fnName) {
        calls.push({
          id: `text_call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name: fnName,
          args,
        });
      }
    }
  }

  return calls;
}

/**
 * Strips raw tool call XML and internal tags from assistant text
 */
function cleanAssistantReply(text: string): string {
  if (!text) return "";
  let cleaned = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "").trim();
  cleaned = cleaned.replace(/<\/?(tool_call|arg_key|arg_value)>/gi, "").trim();
  return cleaned;
}

/**
 * Fallback synthesizer if LLM finishes without textual explanation
 */
function synthesizeResponseFromTools(toolCalls: any[]): string {
  if (!toolCalls || toolCalls.length === 0) return "Data berhasil diproses.";

  const parts: string[] = [];
  for (const tc of toolCalls) {
    if (tc.name === "query_aggregate") {
      const metric = tc.args?.metric;
      if (metric === "top_accounts") {
        const list = tc.result?.data || [];
        if (list.length === 0) {
          parts.push("Saat ini belum ada data akun yang di-repost.");
        } else {
          parts.push(
            "Berikut adalah akun yang paling sering di-repost oleh followers:\n" +
              list
                .slice(0, 10)
                .map(
                  (a: any, i: number) =>
                    `${i + 1}. **@${a.ownerUsername}** — ${a.repostCount} repost (${a.uniqueFollowers} follower unik)`
                )
                .join("\n")
          );
        }
      } else if (metric === "summary") {
        const s = tc.result?.data;
        if (s) {
          parts.push(
            `Ringkasan data riset saat ini:\n- Total Follower: **${s.totalFollowers}** (Selesai: ${s.doneFollowers})\n- Total Postingan Unik: **${s.totalPosts}**\n- Total Aktivitas Repost: **${s.totalReposts}**`
          );
        }
      } else if (metric === "trending_hashtags") {
        const tags = tc.result?.data || [];
        if (tags.length === 0) {
          parts.push("Belum ada data hashtag yang ditemukan pada postingan repost.");
        } else {
          parts.push(
            "Hashtag yang sedang tren dalam konten repost:\n" +
              tags
                .slice(0, 10)
                .map((t: any, i: number) => `${i + 1}. **#${t.hashtag}** (${t.count} kali digunakan)`)
                .join("\n")
          );
        }
      }
    } else if (tc.name === "semantic_search") {
      const results = tc.result?.results || [];
      if (results.length === 0) {
        parts.push(`Tidak ditemukan postingan yang cocok dengan topik "${tc.args?.query}".`);
      } else {
        parts.push(
          `Ditemukan ${results.length} postingan terkait "${tc.args?.query}":\n` +
            results
              .slice(0, 5)
              .map((p: any, i: number) => {
                const snippet = (p.captionText || "").slice(0, 140).replace(/\n/g, " ");
                return `${i + 1}. **@${p.ownerUsername || "anonim"}**: "${snippet}..."`;
              })
              .join("\n")
        );
      }
    }
  }

  return parts.join("\n\n") || "Data berhasil dianalisis.";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userMessage = typeof body.message === "string" ? body.message.trim() : "";

    if (!userMessage) {
      return NextResponse.json({ error: "Pesan tidak boleh kosong" }, { status: 400 });
    }

    const model = process.env.NINEROUTER_CHAT_MODEL || "ag/gemini-3-flash";
    const baseUrl = (process.env.NINEROUTER_BASE_URL || "http://127.0.0.1:20128/v1").replace(/\/$/, "");
    const apiKey = process.env.NINEROUTER_API_KEY || "";
    const endpoint = baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;

    // 1. Save user message to DB (FR-6.5)
    await prisma.chatMessage.create({
      data: {
        role: "user",
        content: userMessage,
      },
    });

    // 2. Fetch recent conversation history
    const rawHistory = await prisma.chatMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    rawHistory.reverse();

    const history = rawHistory
      .filter((m) => !(m.role === "assistant" && m.content?.startsWith("<tool_call>")))
      .map((m) => ({
        role: m.role,
        content: cleanAssistantReply(m.content || ""),
      }));

    const messagesPayload: any[] = [
      {
        role: "system",
        content: `Anda adalah RepostInsight Assistant — analis data riset repost Instagram followers @ynsurabaya.

KONTEKS DATABASE:
- followers: akun Instagram yang di-scrape (memiliki status: done/pending/in_progress/failed)
- posts: konten Instagram unik yang di-repost (memiliki caption, hashtags, media_type, like_count, play_count, taken_at, visual_description)
- repost_events: mencatat follower mana yang me-repost post mana

ROUTING TOOL — IKUTI DENGAN TEPAT:
1. ISI konten, tema narasi, dalil, contoh postingan → semantic_search
2. DISTRIBUSI topik, hashtag dominan, proporsi niche, "paling sering dibahas" → analyze_topics
3. STATISTIK agregat (akun terpopuler, progress scraping, hashtag teratas, timeline) → query_aggregate
4. GRAFIK/VISUALISASI → PERTAMA panggil tool data, KEMUDIAN render_chart dengan data dari tool tersebut
5. Jangan tampilkan tag XML <tool_call> kepada pengguna

POLA MULTI-TOOL (gunakan sequence ini):
- "grafik topik paling sering" → analyze_topics(topN=10) → render_chart(bar, data dari topics[].hashtag & repostEventCount)
- "grafik akun terpopuler" → query_aggregate(top_accounts) → render_chart(bar, data dari repostCount)
- "grafik aktivitas repost" → query_aggregate(activity_timeline, limit=30) → render_chart(line/area)
- "contoh postingan + grafik" → semantic_search → analyze_topics → render_chart

ATURAN ANTI-HALUSINASI (WAJIB):
- DILARANG mengarang, mengestimasi, atau mengasumsikan angka/persentase tanpa data dari tool
- DILARANG gunakan hasil semantic_search untuk menghitung distribusi — sampelnya tidak representatif
- Nilai pada render_chart HARUS diambil verbatim dari hasil tool sebelumnya, bukan dari asumsi
- Jika tidak ada tool yang sesuai, katakan terus terang dan sarankan pertanyaan yang bisa dijawab

MEMBACA HASIL TOOL:
- semantic_search: repostCount = jumlah followers yang me-repost; visualDescription = deskripsi gambar/video dari AI; combinedScore = gabungan relevansi + kebaruan
- analyze_topics: percentageOfAll = proporsi dari SEMUA hashtag di database (bukan hanya top-N); uniquePostCount = berapa postingan berbeda yang memakai hashtag itu
- query_aggregate summary: mencakup breakdown status scraping (done/pending/in_progress/failed) dan embeddingCoveragePct`,
      },
      ...history,
      { role: "user", content: userMessage },
    ];

    let chartToRender: any = null;
    const toolCallsLog: any[] = [];
    let assistantMessage: any = null;

    // Loop for tool execution (up to 4 steps to allow multi-tool sequences)
    let currentStep = 0;
    const maxSteps = 4;

    while (currentStep < maxSteps) {
      currentStep++;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const chatRes = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: messagesPayload,
          tools: CHATBOT_TOOLS,
          tool_choice: "auto",
          stream: false,
        }),
      });

      if (!chatRes.ok) {
        const errText = await chatRes.text();
        throw new Error(`9Router Chat API Error [${chatRes.status}]: ${errText}`);
      }

      const chatData = await chatRes.json();
      assistantMessage = chatData.choices?.[0]?.message;
      if (!assistantMessage) break;

      const extractedCalls = extractToolCalls(assistantMessage);

      // If no tool calls requested, we have our final text answer
      if (extractedCalls.length === 0) {
        break;
      }

      // Execute each tool
      messagesPayload.push({
        role: "assistant",
        content: assistantMessage.content || null,
        tool_calls: assistantMessage.tool_calls || undefined,
      });

      for (const call of extractedCalls) {
        let toolResult: any = null;
        if (call.name === "semantic_search") {
          toolResult = await executeSemanticSearch(call.args?.query, call.args?.limit);
        } else if (call.name === "query_aggregate") {
          toolResult = await executeQueryAggregate(call.args?.metric, call.args?.limit);
        } else if (call.name === "analyze_topics") {
          toolResult = await executeAnalyzeTopics(call.args?.topN);
        } else if (call.name === "render_chart") {
          toolResult = executeRenderChart(call.args?.chartType, call.args?.title, call.args?.data);
          chartToRender = toolResult;
        }

        toolCallsLog.push({ name: call.name, args: call.args, result: toolResult });

        messagesPayload.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolResult),
        });
      }
    }

    // Clean final response text
    let finalContent = cleanAssistantReply(assistantMessage?.content || "");

    // If the model left empty content after tool calls, generate synthesis
    if (!finalContent) {
      finalContent = synthesizeResponseFromTools(toolCallsLog);
    }

    // 5. Save assistant reply to database
    await prisma.chatMessage.create({
      data: {
        role: "assistant",
        content: finalContent,
        toolCalls: toolCallsLog.length > 0 ? (toolCallsLog as any) : undefined,
      },
    });

    return NextResponse.json({
      reply: finalContent,
      chart: chartToRender,
      toolCalls: toolCallsLog,
    });
  } catch (err: unknown) {
    console.error("[API] Error in /api/chat:", err);
    return NextResponse.json(
      {
        error: "Terjadi gangguan saat memproses pesan chat",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
