/* Verifikasi fungsional Task A (8 tool baru) + Task B (MV baru).
 * Jalankan: node node_modules/tsx/dist/cli.mjs scratch/verify_chatbot_v2.ts
 * (dengan cwd = apps/web agar alias @/lib/tools ter-resolve) */
import {
  executeRenderTable,
  executeRenderPostCard,
  executeGetFollowerOverlap,
  executeGetRelatedHashtags,
  executeFindSimilarPosts,
  executeSuggestCollaborationCandidates,
  executeGetSharedInterestClusters,
  executeGetTopicDistribution,
  executeGetPostDetail,
  executeAnalyzeHighPerformingHooks,
} from "@/lib/tools";
import { prisma } from "@repostinsight/db";

async function main() {
  // A7-A8 murni
  console.log("render_table:", JSON.stringify(executeRenderTable(["A", "B"], [["x", 1]])));
  console.log("render_post_card:", JSON.stringify(executeRenderPostCard({ id: "abc" })));

  // Ambil dua owner nyata + satu hashtag nyata + satu post id nyata
  const owners: any[] = await prisma.$queryRawUnsafe(
    `SELECT p.owner_username, COUNT(*)::int c FROM repost_events re JOIN posts p ON p.id=re.post_id GROUP BY 1 ORDER BY c DESC LIMIT 2;`
  );
  console.log("top owners:", JSON.stringify(owners));
  const tags: any[] = await prisma.$queryRawUnsafe(
    `SELECT tag, COUNT(*)::int c FROM posts CROSS JOIN LATERAL unnest(hashtags) tag GROUP BY 1 ORDER BY c DESC LIMIT 1;`
  );
  console.log("top tag:", JSON.stringify(tags));
  const embCount: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int c FROM posts WHERE embedding IS NOT NULL;`
  );
  console.log("posts with embedding:", JSON.stringify(embCount));

  if (owners.length === 2) {
    const ov = await executeGetFollowerOverlap(owners[0].owner_username, owners[1].owner_username);
    console.log("A4 overlap:", JSON.stringify({ ...ov, overlappingFollowers: ov.overlappingFollowers.slice(0, 3) }));
    const collab = await executeSuggestCollaborationCandidates(owners[0].owner_username, 3);
    console.log("A2 collab:", JSON.stringify(collab).slice(0, 400));
  }
  if (tags.length) {
    const rel = await executeGetRelatedHashtags(tags[0].tag, 5);
    console.log("A6 related:", JSON.stringify(rel).slice(0, 400));
  }

  // A5: satu post ber-embedding sebagai acuan
  const ref: any[] = await prisma.$queryRawUnsafe(
    `SELECT id FROM posts WHERE embedding IS NOT NULL LIMIT 1;`
  );
  if (ref.length) {
    const sim = await executeFindSimilarPosts(ref[0].id, 3);
    console.log("A5 similar:", JSON.stringify(sim).slice(0, 500));
    const det: any = await executeGetPostDetail(ref[0].id);
    console.log("post_detail keys:", Object.keys(det).join(","), "| thumbnail:", det.thumbnailUrl ? "ada" : "null");
  } else {
    console.log("A5 SKIPPED: belum ada post ber-embedding");
  }

  // A1 + distribusi: topic_label masih NULL semua -> harus kosong, bukan crash
  const clusters = await executeGetSharedInterestClusters(3);
  console.log("A1 clusters (ekspektasi kosong):", JSON.stringify(clusters));
  const dist: any = await executeGetTopicDistribution(5);
  console.log("TaskB dist:", JSON.stringify({ ...dist, topics: dist.topics }).slice(0, 500));

  // A3 butuh LLM 9Router — coba, toleran gagal (covergae: panggil & laporkan)
  try {
    const hooks = await executeAnalyzeHighPerformingHooks(5);
    console.log("A3 hooks OK, sampleSize:", hooks.sampleSize, "| patterns len:", (hooks.patterns || "").length);
  } catch (e: any) {
    console.log("A3 hooks GAGAL (LLM tidak tersedia?):", e.message.slice(0, 200));
  }

  await prisma.$disconnect();
}

main();
