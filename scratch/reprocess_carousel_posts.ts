import { PrismaClient } from "@repostinsight/db";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

import { describePost, PostForDescribe } from "../apps/worker/src/visualDescriber";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Memulai Pembaruan Deskripsi Visual untuk Seluruh Postingan Carousel ===");

  const carousels = await prisma.post.findMany({
    where: {
      OR: [
        { mediaType: "8" },
        { mediaType: "Sidecar" },
        { mediaType: "carousel" },
      ],
    },
    select: {
      id: true,
      mediaType: true,
      captionText: true,
      rawJson: true,
      visualDescription: true,
      visualDescriptionStatus: true,
    },
  });

  console.log(`Ditemukan ${carousels.length} postingan carousel di database.\n`);

  for (let i = 0; i < carousels.length; i++) {
    const post = carousels[i];
    console.log(`[${i + 1}/${carousels.length}] Memproses carousel post ${post.id}...`);

    const postForDescribe: PostForDescribe = {
      id: post.id,
      mediaType: post.mediaType,
      captionText: post.captionText,
      rawJson: post.rawJson as Record<string, unknown> | null,
    };

    try {
      const newDesc = await describePost(postForDescribe);
      await prisma.$executeRawUnsafe(
        `UPDATE posts SET visual_description = $1, visual_description_status = 'done', embedding_status = 'pending', last_updated_at = NOW() WHERE id = $2`,
        newDesc,
        post.id,
      );
      console.log(`  ✓ Berhasil mendeskripsikan seluruh slide untuk post ${post.id} (${newDesc.length} karakter).`);
    } catch (err: any) {
      console.error(`  ✗ Gagal untuk post ${post.id}:`, err.message);
    }
  }

  console.log("\n=== Seluruh postingan carousel selesai diproses! ===");
}

main().finally(() => prisma.$disconnect());
