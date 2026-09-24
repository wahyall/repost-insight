import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";
import {
  CHATBOT_TOOLS,
  executeSemanticSearch,
  executeQueryAggregate,
  executeRenderChart,
} from "@/lib/tools";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userMessage = typeof body.message === "string" ? body.message.trim() : "";

    if (!userMessage) {
      return NextResponse.json({ error: "Pesan tidak boleh kosong" }, { status: 400 });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_CHAT_MODEL || "openrouter/free";

    // 1. Save user message to DB (FR-6.5)
    await prisma.chatMessage.create({
      data: {
        role: "user",
        content: userMessage,
      },
    });

    // If no API key configured, provide a helpful mock response
    if (!apiKey) {
      const fallbackReply =
        "OPENROUTER_API_KEY belum disetel pada file `.env`. Untuk menggunakan chatbot cerdas dengan model OpenRouter gratis, silakan masukkan API Key Anda.";
      await prisma.chatMessage.create({
        data: {
          role: "assistant",
          content: fallbackReply,
        },
      });
      return NextResponse.json({
        reply: fallbackReply,
      });
    }

    // 2. Fetch recent conversation history
    const history = await prisma.chatMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
    });
    history.reverse();

    const messagesPayload: any[] = [
      {
        role: "system",
        content: `Anda adalah RepostInsight Assistant — analis data riset repost Instagram followers @ynsurabaya.
Tugas Anda:
1. Menjawab pertanyaan pengguna dengan akurat, ramah, dan berbasis data nyata (Bahasa Indonesia).
2. Jika pengguna bertanya tentang isi konten, topik postingan, narasi, atau kajian tertentu -> gunakan tool 'semantic_search'.
3. Jika pengguna bertanya tentang peringkat, jumlah total, statistik akun paling banyak direpost, atau hashtag terpopuler -> gunakan tool 'query_aggregate'.
4. Jika pengguna meminta grafik visual, perbandingan visual, atau chart -> setelah mengambil data dengan query_aggregate/semantic_search, panggil tool 'render_chart' untuk menampilkannya.`,
      },
      ...history.map((m) => ({
        role: m.role,
        content: m.content || "",
      })),
    ];

    // 3. First OpenRouter call (model + tools)
    let chatRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://repostinsight.local",
        "X-Title": "RepostInsight",
      },
      body: JSON.stringify({
        model,
        messages: messagesPayload,
        tools: CHATBOT_TOOLS,
        tool_choice: "auto",
      }),
    });

    if (!chatRes.ok) {
      const errText = await chatRes.text();
      throw new Error(`OpenRouter Chat API Error [${chatRes.status}]: ${errText}`);
    }

    let chatData = await chatRes.json();
    let choice = chatData.choices?.[0];
    let assistantMessage = choice?.message;

    let chartToRender: any = null;
    let toolCallsLog: any[] = [];

    // 4. Handle tool calls if returned by LLM
    if (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
      messagesPayload.push(assistantMessage);

      for (const call of assistantMessage.tool_calls) {
        const fnName = call.function?.name;
        let fnArgs: any = {};
        try {
          fnArgs = JSON.parse(call.function?.arguments || "{}");
        } catch {
          fnArgs = {};
        }

        let toolResult: any = null;
        if (fnName === "semantic_search") {
          toolResult = await executeSemanticSearch(fnArgs.query, fnArgs.limit);
        } else if (fnName === "query_aggregate") {
          toolResult = await executeQueryAggregate(fnArgs.metric, fnArgs.limit);
        } else if (fnName === "render_chart") {
          toolResult = executeRenderChart(fnArgs.chartType, fnArgs.title, fnArgs.data);
          chartToRender = toolResult;
        }

        toolCallsLog.push({ name: fnName, args: fnArgs, result: toolResult });

        messagesPayload.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolResult),
        });
      }

      // Second call to get final synthesized response from LLM
      const followUpRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: messagesPayload,
        }),
      });

      if (followUpRes.ok) {
        const followUpData = await followUpRes.json();
        assistantMessage = followUpData.choices?.[0]?.message || assistantMessage;
      }
    }

    const finalContent = assistantMessage?.content || "Data berhasil diproses.";

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
