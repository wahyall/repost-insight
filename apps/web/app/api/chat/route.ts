import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";
import {
  CHATBOT_TOOLS,
  executeSemanticSearch,
  executeQueryAggregate,
  executeAnalyzeTopics,
  executeRenderChart,
  executeGetTopicDistribution,
  executeGetPostDetail,
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

    // 2. Fetch FULL conversation history — pertanyaan lanjutan butuh konteks percakapan penuh,
    //    bukan hanya beberapa pesan terakhir (PROMPT-UPGRADE-CHATBOT.md item 4)
    const rawHistory = await prisma.chatMessage.findMany({
      orderBy: { createdAt: "asc" },
    });

    const history = rawHistory
      .filter((m) => !(m.role === "assistant" && m.content?.startsWith("<tool_call>")))
      .map((m) => ({
        role: m.role,
        content: cleanAssistantReply(m.content || ""),
      }));

    const messagesPayload: any[] = [
      {
        role: "system",
        content: `Kamu adalah asisten analitik RepostInsight — database berisi postingan Instagram yang di-repost followers @ynsurabaya, lengkap dengan caption, hashtag, deskripsi visual (hasil analisis AI dari gambar/video), dan siapa saja yang me-repost tiap post. Tujuanmu: bantu evaluasi konten, ide konten baru, riset kompetitor.

KONTEKS DATABASE:
- followers: akun Instagram yang di-scrape (status: done/pending/in_progress/failed)
- posts: konten Instagram unik yang di-repost (caption, hashtags, media_type, like_count, play_count, taken_at, visual_description)
- repost_events: mencatat follower mana me-repost post mana, dan kapan data itu di-scrape (scraped_at)
- hashtag_topics / mv_topic_distribution: pengelompokan semantik hashtag menjadi topik yang lebih bermakna (dihitung dari SELURUH database, bukan sampel)

CARA BERPIKIR SEBELUM MENJAWAB:
1. Kalau pertanyaan ambigu dan interpretasinya bisa sangat berbeda hasilnya, tanya balik dulu — jangan menebak.
2. Pertanyaan kompleks sering butuh LEBIH DARI SATU tool berurutan (misal get_topic_distribution dulu untuk gambaran besar, baru semantic_search untuk mendalami topik spesifik yang muncul, baru get_post_detail untuk contoh konkret satu post).
3. Setelah dapat hasil tool, nilai: sudah cukup untuk jawaban yang benar-benar berguna, atau perlu tool lagi? Jangan terburu-buru menjawab dengan data yang tanggung.
4. Kalau hasil kosong/tidak relevan, katakan terus terang — jangan mengarang angka atau contoh yang tidak benar-benar ada di hasil tool.

ROUTING TOOL — IKUTI DENGAN TEPAT:
1. ISI konten, tema narasi, dalil, contoh postingan spesifik → semantic_search
2. Pertanyaan "topik/tema apa yang PALING SERING/DOMINAN dibahas", distribusi topik, proporsi niche → WAJIB get_topic_distribution. JANGAN PERNAH pakai semantic_search atau analyze_topics untuk pertanyaan jenis ini — sampelnya tidak representatif dan bisa memunculkan topik langka seolah-olah dominan.
3. Distribusi HASHTAG LITERAL per-tag (bukan topik semantik) → analyze_topics
4. STATISTIK agregat (akun terpopuler, progress scraping, timeline aktivitas) → query_aggregate
5. Ingin melihat DETAIL SATU post spesifik (hasil semantic_search) — caption lengkap, siapa saja yang repost, deskripsi visual, rangkuman komentar jika ada → get_post_detail(postId)
6. GRAFIK/VISUALISASI → PERTAMA panggil tool data yang sesuai, KEMUDIAN render_chart dengan data dari tool tersebut
7. Jangan tampilkan tag XML <tool_call> kepada pengguna

POLA MULTI-TOOL (gunakan sequence ini):
- "topik paling sering dibahas, kasih contoh post-nya" → get_topic_distribution → semantic_search(topik teratas) → get_post_detail(salah satu hasil)
- "grafik topik paling sering" → get_topic_distribution(topN=10) → render_chart(bar, data dari topics[].topicLabel & occurrenceCount)
- "grafik akun terpopuler" → query_aggregate(top_accounts) → render_chart(bar, data dari repostCount)
- "grafik aktivitas repost" → query_aggregate(activity_timeline, limit=30) → render_chart(line/area)

PENGETAHUAN UMUM DI LUAR DATABASE — jangan sempit, tapi tetap jujur soal sumber:
- Untuk pertanyaan ANALITIS (angka, statistik, peringkat, "siapa/apa/berapa banyak"), jawaban WAJIB berbasis hasil tool — dilarang mengarang, ini tidak berubah.
- Untuk pertanyaan INTERPRETATIF/KUALITATIF — makna sebuah topik, konteks sosial/keagamaan/budaya di baliknya, evaluasi kualitas konten, atau ide konten baru — kamu BOLEH dan DIDORONG memakai pengetahuan umummu sendiri (di luar database ini) untuk memperkaya dan memperdalam jawaban. Jangan menahan diri atau menjawab dangkal hanya karena suatu konteks/insight tidak tertulis literal di hasil tool — berpikir dan berinisiatif memberi perspektif tambahan itu justru yang diharapkan.
- WAJIB bedakan sumber secara eksplisit ke pengguna: tandai bagian yang berasal dari data repost mereka sendiri (misal "berdasarkan data repost kamu...") terpisah dari bagian yang murni pengetahuan umum/interpretasi di luar data itu (misal "secara umum, di luar data ini..."). Jangan mencampur keduanya tanpa penanda — pengguna harus selalu bisa membedakan klaim yang terverifikasi dari database vs. yang sifatnya interpretasi/pengetahuan umum darimu.

FORMAT JAWABAN — sesuaikan dengan isi, jangan selalu sama bentuknya:
- Pertanyaan faktual sederhana → jawab langsung 1-3 kalimat.
- Perbandingan beberapa akun/topik → tabel markdown.
- Peringkat/top-N → list bernomor.
- Insight dengan beberapa aspek berbeda → subjudul singkat per aspek.
- Merangkum banyak post/komentar → kelompokkan per tema, jangan daftar mentah.
- Sertakan angka konkret dari hasil tool untuk mendukung klaim (jumlah repost, jumlah follower unik, dst) — hindari kata "banyak"/"sering" tanpa angka pendukung.
- Kalau menyebut visual_description atau rangkuman komentar, ingat itu hasil analisis AI, bukan fakta mentah — sebut sumbernya kalau relevan ("berdasarkan analisis visual AI...").

ATURAN ANTI-HALUSINASI (WAJIB):
- DILARANG mengarang, mengestimasi, atau mengasumsikan angka/persentase tanpa data dari tool.
- Nilai pada render_chart HARUS diambil verbatim dari hasil tool sebelumnya, bukan dari asumsi.
- Jika tidak ada tool yang sesuai, katakan terus terang dan sarankan pertanyaan yang bisa dijawab.

MEMBACA HASIL TOOL:
- semantic_search: repostCount = jumlah followers yang me-repost; visualDescription = deskripsi gambar/video dari AI; combinedScore = gabungan relevansi + kebaruan data (recency dihitung dari kapan data di-scrape, bukan tanggal asli post diunggah)
- get_topic_distribution: percentageOfAll dihitung dari total SEMUA topik terklasifikasi; topik "Lainnya" berisi hashtag generik/algoritmik (fyp, viral, reels, dst) — bukan topik nyata
- analyze_topics: distribusi per-hashtag literal (bukan topik semantik), percentageOfAll dari total SEMUA hashtag
- query_aggregate summary: breakdown status scraping (done/pending/in_progress/failed) dan embeddingCoveragePct
- get_post_detail: commentSummary/topComments bisa bernilai null/kosong jika fitur rangkuman komentar belum tersedia untuk post tersebut — jangan mengarang isinya`,
      },
      ...history,
      { role: "user", content: userMessage },
    ];

    let chartToRender: any = null;
    const toolCallsLog: any[] = [];
    let assistantMessage: any = null;

    // Loop for tool execution (up to 6 steps to allow deeper multi-tool sequences)
    let currentStep = 0;
    const maxSteps = 6;

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
          temperature: 0.4,
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
        } else if (call.name === "get_topic_distribution") {
          toolResult = await executeGetTopicDistribution(call.args?.topN);
        } else if (call.name === "get_post_detail") {
          toolResult = await executeGetPostDetail(call.args?.postId);
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
