import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

import { describePost, PostForDescribe } from "../apps/worker/src/visualDescriber";

async function main() {
  console.log("=== Menguji visualDescriber dengan 9Router API (ag/gemini-3-flash) ===");

  // Contoh post gambar dengan URL gambar publik yang valid
  const testPost: PostForDescribe = {
    id: "test_visual_post_1",
    mediaType: "1", // Photo
    captionText: "Kajian rutin malam jumat bersama Ustadz di Masjid Al-Falah Surabaya. Membahas tafsir ad-Dhuha.",
    rawJson: {
      displayUrl: "https://images.unsplash.com/photo-1542838132-92c53300491e?w=600",
    },
  };

  console.log("Mengirim request deskripsi visual gambar...");
  const description = await describePost(testPost);
  console.log("\n[HASIL DESKRIPSI VISUAL GAMBAR]:\n", description);
}

main().catch(console.error);
