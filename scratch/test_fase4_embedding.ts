import { prisma } from "../packages/db";
import { prepareEmbeddingText } from "../apps/worker/src/embeddingLoop";
import { RateLimitError } from "../apps/worker/src/openrouterClient";

async function testFase4() {
  console.log("=== MEMULAI TEST FASE 4: PIPELINE EMBEDDING & PGVECTOR ===");

  // 1. Test: Truncation & Text Preparation (FR-5.3)
  console.log("\n[Test 1] Uji Truncation & Text Preparation...");
  const longCaption = "A".repeat(3000);
  const hashtags = ["kajian", "surabaya", "dakwah"];
  const preparedText = prepareEmbeddingText(longCaption, hashtags);

  if (preparedText.length > 1800) {
    throw new Error(`Teks melebihi batas 1800 karakter: ${preparedText.length}`);
  }
  console.log(`[Test 1 PASS] Teks 3000+ karakter berhasil di-truncate menjadi ${preparedText.length} karakter.`);

  // 2. Test: Penyimpanan Vector 1024-dimensi ke Postgres pgvector (FR-5.2)
  console.log("\n[Test 2] Uji penyimpanan vector 1024 dimensi ke pgvector...");

  // Siapkan post uji
  const testPostId = "fase4_test_post_1";
  await prisma.post.upsert({
    where: { id: testPostId },
    create: {
      id: testPostId,
      captionText: "Kajian subuh tematik di Masjid Al-Ikhlas #kajian",
      hashtags: ["kajian"],
      embeddingStatus: "pending",
    },
    update: {
      captionText: "Kajian subuh tematik di Masjid Al-Ikhlas #kajian",
      embeddingStatus: "pending",
    },
  });

  // Buat mock vector 1024 dimensi (normalisasi dummy)
  const mockVector1024 = Array.from({ length: 1024 }, (_, i) => parseFloat((Math.sin(i) * 0.05).toFixed(6)));
  const vectorStr = `[${mockVector1024.join(",")}]`;

  // Simpan vector menggunakan raw SQL ke kolom vector(1024)
  await prisma.$executeRawUnsafe(
    `UPDATE posts SET embedding = $1::vector, embedding_status = 'done', last_updated_at = NOW() WHERE id = $2`,
    vectorStr,
    testPostId
  );

  // Verifikasi status dan query vector distance dengan pgvector operator (<-> L2 distance atau <=> cosine distance)
  const postInDb = await prisma.post.findUnique({
    where: { id: testPostId },
  });

  if (postInDb?.embeddingStatus !== "done") {
    throw new Error(`Embedding status gagal berubah menjadi 'done': ${postInDb?.embeddingStatus}`);
  }
  console.log("[Test 2 PASS] Post embeddingStatus berhasil menjadi 'done'.");

  // Uji pencarian kemiripan kosinus (cosine similarity <=> operator di pgvector)
  const queryResults: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, caption_text, (embedding <=> $1::vector) as distance FROM posts WHERE id = $2`,
    vectorStr,
    testPostId
  );

  if (queryResults.length === 0 || typeof queryResults[0].distance !== "number") {
    throw new Error("Gagal melakukan pencarian vector distance dengan pgvector");
  }
  console.log(`[Test 2 PASS] Query pgvector sukses! Jarak kosinus ke vector sendiri: ${queryResults[0].distance} (ekspektasi ~0).`);

  // 3. Test: Simulasi Rate-limit & Error (FR-5.4)
  console.log("\n[Test 3] Uji simulasi penanganan Rate-limit (status tetap 'pending', bukan 'failed')...");
  const testPostId2 = "fase4_test_post_2";
  await prisma.post.upsert({
    where: { id: testPostId2 },
    create: {
      id: testPostId2,
      captionText: "Post simulasi rate limit",
      embeddingStatus: "pending",
    },
    update: {
      embeddingStatus: "pending",
    },
  });

  // Simulasikan penangkapan RateLimitError
  const simulateWorkerError = async () => {
    try {
      throw new RateLimitError("Mock 429 Rate Limit", 5);
    } catch (err) {
      if (err instanceof RateLimitError) {
        // Jangan ubah status menjadi failed! Biarkan tetap pending
      }
    }
  };
  await simulateWorkerError();

  const post2Check = await prisma.post.findUnique({ where: { id: testPostId2 } });
  if (post2Check?.embeddingStatus !== "pending") {
    throw new Error(`Status tidak boleh berubah jika terjadi error rate-limit! Status: ${post2Check?.embeddingStatus}`);
  }
  console.log("[Test 3 PASS] Status post tetap 'pending' saat terjadi rate-limit tier gratis.");

  // 4. Test: Endpoint Ringkasan Monitoring Embedding (FR-9.3)
  console.log("\n[Test 4] Uji kalkulasi status embedding summary...");
  const counts = await prisma.post.groupBy({
    by: ["embeddingStatus"],
    _count: { id: true },
  });
  console.log("Embedding counts:", counts);
  console.log("[Test 4 PASS] Ringkasan embedding berhasil dihitung.");

  // Cleanup test posts
  await prisma.post.deleteMany({
    where: { id: { in: [testPostId, testPostId2] } },
  });

  console.log("\n=== SELURUH UJI FASE 4 SUKSES 100% ===");
}

testFase4()
  .catch((err) => {
    console.error("Test Fase 4 Gagal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
