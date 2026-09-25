import { prisma } from "@repostinsight/db";
import { OllamaEmbeddingService } from "../apps/worker/src/ollamaClient";

async function main() {
  console.log("=== TEST PGVECTOR 1024 DIMENSI DENGAN OLLAMA ===");
  const ollama = new OllamaEmbeddingService();

  const testText = "kajian fiqih dan sunnah di surabaya";
  console.log(`Meng-embed teks: "${testText}"...`);
  const [res] = await ollama.generateEmbeddings([testText]);

  if (!res || res.embedding.length !== 1024) {
    throw new Error(`Embedding gagal atau dimensi bukan 1024: ${res?.embedding?.length}`);
  }
  console.log(`OK: Vektor dihasilkan dengan panjang ${res.embedding.length} dimensi.`);

  // Simulasikan update ke salah satu post yang ada
  const post = await prisma.post.findFirst();
  if (!post) {
    console.log("Belum ada post di DB, membuat mock post...");
    const mockPost = await prisma.post.create({
      data: {
        id: "test_post_ollama_1",
        ownerUsername: "test_user",
        captionText: testText,
        embeddingStatus: "pending",
      },
    });
    return testWithPost(mockPost.id, res.embedding);
  }

  await testWithPost(post.id, res.embedding);
}

async function testWithPost(postId: string, embedding: number[]) {
  const vectorStr = `[${embedding.join(",")}]`;

  console.log(`Menyimpan vector ke post id: ${postId}...`);
  await prisma.$executeRawUnsafe(
    `UPDATE posts SET embedding = $1::vector, embedding_status = 'done', last_updated_at = NOW() WHERE id = $2`,
    vectorStr,
    postId
  );
  console.log("OK: Vector 1024 berhasil disimpan ke PostgreSQL pgvector.");

  // Test cosine distance query
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, caption_text, (embedding <=> $1::vector) as distance FROM posts WHERE id = $2`,
    vectorStr,
    postId
  );

  console.log("Hasil query kemiripan kosinus:", rows);
  if (rows.length > 0 && Math.abs(rows[0].distance) < 0.001) {
    console.log(`PASS: Jarak kosinus ke vektor sendiri adalah ~0 (${rows[0].distance}).`);
  } else {
    throw new Error("Cosine distance query tidak sesuai harapan.");
  }
}

main()
  .catch((err) => {
    console.error("GAGAL:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
