// Jalankan: npx tsx src/migrate_fase8.ts (dari dalam packages/db)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function migrate() {
  console.log("Menjalankan migrasi Fase 8...");

  try {
    // --- Kolom visual_description (Fase 8 F10) ---
    await prisma.$executeRawUnsafe(`
      ALTER TABLE posts
        ADD COLUMN IF NOT EXISTS visual_description text,
        ADD COLUMN IF NOT EXISTS visual_description_status text NOT NULL DEFAULT 'pending'
    `);
    console.log("OK: kolom visual_description dan visual_description_status ditambahkan.");

    // --- Migrasi model embedding: 1024 → 2048 dimensi (SRS §12) ---
    // Cek dimensi kolom embedding yang ada sekarang
    const colInfo: any[] = await prisma.$queryRawUnsafe(`
      SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) AS col_type
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'posts' AND a.attname = 'embedding' AND a.attnum > 0
    `);

    const currentType: string = colInfo[0]?.col_type ?? "";
    console.log("Tipe kolom embedding saat ini:", currentType || "(tidak ada)");

    if (!currentType.includes("2048")) {
      console.log("Melakukan migrasi kolom embedding ke vector(2048) (output model nvidia/llama-nemotron-embed-vl-1b-v2:free)...");
      await prisma.$executeRawUnsafe(`ALTER TABLE posts DROP COLUMN IF EXISTS embedding`);
      await prisma.$executeRawUnsafe(`ALTER TABLE posts ADD COLUMN embedding vector(2048)`);
      await prisma.$queryRawUnsafe(
        `UPDATE posts SET embedding_status = 'pending' WHERE embedding_status = 'done'`
      );
      console.log(`OK: kolom embedding berhasil dimigrasikan ke vector(2048).`);
    } else {
      console.log("Kolom embedding sudah vector(2048), tidak perlu migrasi.");
    }

    // Verifikasi semua kolom baru
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'posts'
        AND column_name IN ('visual_description', 'visual_description_status')
      ORDER BY column_name
    `);
    console.log("Verifikasi kolom:");
    rows.forEach((r: any) =>
      console.log(` - ${r.column_name} | ${r.data_type} | default: ${r.column_default}`)
    );
  } finally {
    await prisma.$disconnect();
  }
}

migrate().catch((err) => {
  console.error("GAGAL:", err);
  process.exit(1);
});
