import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../packages/db";
import {
  normalizeCommentText,
  filterLowSignalComments,
  buildCommentSummaryPrompt,
} from "../apps/worker/src/commentLoop";
import { prepareEmbeddingText } from "../apps/worker/src/embeddingLoop";
import {
  executeGetCommunitySentimentPulse,
  executeDetectRecurringQuestions,
  executeSearchComments,
  executeGetMostLikedCommentsOverall,
  executeGetCommentToRepostRatio,
  executeGetPostDetail,
} from "../apps/web/lib/tools";

async function runTests() {
  console.log("==========================================");
  console.log("  Testing F11: Comment Analysis Features  ");
  console.log("==========================================");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}`);
      failed++;
    }
  }

  // 1. Unit Test: normalizeCommentText
  const norm1 = normalizeCommentText("Alasanku 🙌");
  const norm2 = normalizeCommentText("  alasanku  ");
  const norm3 = normalizeCommentText("ALASANKU!!!");
  assert(norm1 === "alasanku", `normalizeCommentText removes emojis: "${norm1}" === "alasanku"`);
  assert(norm2 === "alasanku", `normalizeCommentText trims spaces: "${norm2}" === "alasanku"`);
  assert(norm3 === "alasanku", `normalizeCommentText removes punctuation: "${norm3}" === "alasanku"`);

  // 2. Unit Test: filterLowSignalComments (FR-11.10)
  const testComments = [
    { id: "1", text: "Alasanku", comment_like_count: 0 },
    { id: "2", text: "alasanku 🙌", comment_like_count: 1 },
    { id: "3", text: "ALASANKU!!", comment_like_count: 0 },
    { id: "4", text: "MasyaAllah kontennya sangat menginspirasi", comment_like_count: 15 },
    { id: "5", text: "Bagaimana cara ikut kajiannya kak?", comment_like_count: 5 },
  ];
  const filtered = filterLowSignalComments(testComments, 3);
  assert(
    filtered.length === 2 &&
      filtered.some((c) => c.id === "4") &&
      filtered.some((c) => c.id === "5"),
    `filterLowSignalComments drops comments with >=3 duplicates (kept: ${filtered.map((c) => c.text).join(", ")})`
  );

  // 3. Unit Test: prepareEmbeddingText includes commentSummary (FR-11.5)
  const embedText = prepareEmbeddingText(
    "Ini caption asli",
    ["kajian", "surabaya"],
    "Gambar poster jadwal kajian",
    "Banyak yang menanyakan lokasi parkir dan pendaftaran"
  );
  assert(
    embedText.includes("#kajian #surabaya") &&
      embedText.includes("Gambar poster jadwal kajian") &&
      embedText.includes("Banyak yang menanyakan lokasi parkir dan pendaftaran") &&
      embedText.includes("Ini caption asli"),
    "prepareEmbeddingText properly combines hashtags, visual description, comment summary, and caption"
  );

  // 4. DB schema verification
  const postCounts = await prisma.post.groupBy({
    by: ["commentsStatus"],
    _count: { id: true },
  });
  console.log("DB commentsStatus distribution:", postCounts);
  assert(postCounts.length > 0, "DB posts have commentsStatus column");

  const totalComments = await prisma.comment.count();
  console.log("DB total comments count:", totalComments);
  assert(typeof totalComments === "number", "DB comments table is queryable");

  // 5. Test Chatbot Tools (F11)
  console.log("\nTesting Chatbot Tools...");

  // 5.1 executeGetCommunitySentimentPulse
  const pulse = await executeGetCommunitySentimentPulse(10);
  assert(pulse !== undefined && "sampleSize" in pulse, "executeGetCommunitySentimentPulse executes cleanly");
  console.log("  Pulse sample size:", pulse.sampleSize);

  // 5.2 executeDetectRecurringQuestions
  const questions = await executeDetectRecurringQuestions(10);
  assert(questions !== undefined && "sampleSize" in questions, "executeDetectRecurringQuestions executes cleanly");
  console.log("  Recurring questions sample size:", questions.sampleSize);

  // 5.3 executeSearchComments
  const searchRes = await executeSearchComments("info", 5);
  assert(searchRes !== undefined && Array.isArray(searchRes.results), "executeSearchComments executes cleanly");
  console.log("  Search results count:", searchRes.count);

  // 5.4 executeGetMostLikedCommentsOverall
  const mostLiked = await executeGetMostLikedCommentsOverall(5);
  assert(mostLiked !== undefined && Array.isArray(mostLiked.results), "executeGetMostLikedCommentsOverall executes cleanly");
  console.log("  Most liked comments count:", mostLiked.count);

  // 5.5 executeGetCommentToRepostRatio
  const ratios = await executeGetCommentToRepostRatio(5);
  assert(ratios !== undefined && Array.isArray(ratios.results), "executeGetCommentToRepostRatio executes cleanly");
  console.log("  Ratio results count:", ratios.results.length);

  // 5.6 executeGetPostDetail
  const firstPost = await prisma.post.findFirst({ select: { id: true } });
  if (firstPost) {
    const detail = await executeGetPostDetail(firstPost.id);
    assert(
      detail.found && "commentSummary" in detail && "topComments" in detail,
      "executeGetPostDetail includes commentSummary and topComments"
    );
  }

  console.log("\n==========================================");
  console.log(`Summary: ${passed} PASS, ${failed} FAIL`);
  console.log("==========================================");

  if (failed > 0) process.exit(1);
}

runTests()
  .catch((err) => {
    console.error("Test execution error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
