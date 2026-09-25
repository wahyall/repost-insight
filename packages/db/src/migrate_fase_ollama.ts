// Jalankan: npx.cmd tsx src/migrate_fase_ollama.ts (dari dalam packages/db)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function migrate() {
  console.log("Menjalankan migrasi database untuk Ollama Embedding (1024 dimensi)...");

  try {
    // 1. Cek dimensi kolom embedding yang ada sekarang
    const colInfo: any[] = await prisma.$queryRawUnsafe(`
      SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) AS col_type
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'posts' AND a.attname = 'embedding' AND a.attnum > 0
    `);

    const currentType: string = colInfo[0]?.col_type ?? "";
    console.log("Tipe kolom embedding saat ini:", currentType || "(tidak ada)");

    if (!currentType.includes("1024")) {
      console.log("Melakukan migrasi kolom embedding ke vector(1024) (output model qwen3-embedding:0.6b)...");
      await prisma.$executeRawUnsafe(`ALTER TABLE posts DROP COLUMN IF EXISTS embedding`);
      await prisma.$executeRawUnsafe(`ALTER TABLE posts ADD COLUMN embedding vector(1024)`);
      const updated = await prisma.$executeRawUnsafe(
        `UPDATE posts SET embedding_status = 'pending' WHERE embedding_status = 'done'`
      );
      console.log(`OK: kolom embedding berhasil dimigrasikan ke vector(1024). ${updated} post di-reset ke status 'pending'.`);
    } else {
      console.log("Kolom embedding sudah vector(1024), tidak perlu migrasi.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

migrate().catch((err) => {
  console.error("GAGAL:", err);
  process.exit(1);
});
