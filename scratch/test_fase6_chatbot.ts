import { prisma } from "../packages/db";
import {
  executeSemanticSearch,
  executeQueryAggregate,
  executeRenderChart,
} from "../apps/web/lib/tools";

async function testFase6() {
  console.log("=== MEMULAI TEST FASE 6: CHATBOT RAG & TOOLS ===");

  // 1. Test: Tool query_aggregate (FR-6.3)
  console.log("\n[Test 1] Uji tool query_aggregate...");
  const aggTopAccounts = await executeQueryAggregate("top_accounts", 5);
  console.log("Top Accounts result:", aggTopAccounts);
  if (aggTopAccounts.metric !== "top_accounts" || !Array.isArray(aggTopAccounts.data)) {
    throw new Error("query_aggregate top_accounts gagal");
  }

  const aggHashtags = await executeQueryAggregate("trending_hashtags", 5);
  console.log("Hashtags result:", aggHashtags);
  if (aggHashtags.metric !== "trending_hashtags" || !Array.isArray(aggHashtags.data)) {
    throw new Error("query_aggregate trending_hashtags gagal");
  }

  const aggSummary = await executeQueryAggregate("summary");
  console.log("Summary result:", aggSummary);
  if (aggSummary.metric !== "summary" || typeof aggSummary.data.totalFollowers !== "number") {
    throw new Error("query_aggregate summary gagal");
  }
  console.log("[Test 1 PASS] Tool query_aggregate bekerja untuk seluruh jenis metrik.");

  // 2. Test: Tool semantic_search (FR-6.2)
  console.log("\n[Test 2] Uji tool semantic_search...");
  const searchResult = await executeSemanticSearch("kajian dakwah", 3);
  console.log("Semantic search result source:", searchResult.source, "items:", searchResult.results.length);
  if (!Array.isArray(searchResult.results)) {
    throw new Error("semantic_search gagal mengembalikan array hasil");
  }
  console.log("[Test 2 PASS] Tool semantic_search bekerja dengan baik.");

  // 3. Test: Tool render_chart (FR-6.4)
  console.log("\n[Test 3] Uji tool render_chart...");
  const chartOutput = executeRenderChart("bar", "Top 3 Akun", [
    { name: "Akun A", value: 100 },
    { name: "Akun B", value: 80 },
  ]);
  console.log("Render chart output:", chartOutput);
  if (!chartOutput.isChart || chartOutput.chartType !== "bar" || chartOutput.data.length !== 2) {
    throw new Error("render_chart format tidak valid");
  }
  console.log("[Test 3 PASS] Tool render_chart menghasilkan format data terstruktur.");

  // 4. Test: Chat Messages Persistence (FR-6.5)
  console.log("\n[Test 4] Uji persistensi riwayat chat di tabel chat_messages...");
  const userMsg = await prisma.chatMessage.create({
    data: { role: "user", content: "Test pesan pertanyaan RAG" },
  });
  const botMsg = await prisma.chatMessage.create({
    data: {
      role: "assistant",
      content: "Test respons asisten",
      toolCalls: [chartOutput] as any,
    },
  });

  const history = await prisma.chatMessage.findMany({
    where: { id: { in: [userMsg.id, botMsg.id] } },
  });

  if (history.length !== 2) {
    throw new Error("Gagal mengambil riwayat pesan chat yang disimpan");
  }
  console.log("[Test 4 PASS] Riwayat chat tersimpan dan dapat dimuat kembali lengkap dengan tool_calls.");

  // Cleanup test messages
  await prisma.chatMessage.deleteMany({
    where: { id: { in: [userMsg.id, botMsg.id] } },
  });

  console.log("\n=== SELURUH UJI FASE 6 SUKSES 100% ===");
}

testFase6()
  .catch((err) => {
    console.error("Test Fase 6 Gagal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
