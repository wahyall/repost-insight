import path from "path";
import dotenv from "dotenv";

// Same env-loading order as index.ts: worker .env first, then root .env with override
dotenv.config();
const rootEnvPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: rootEnvPath, override: true });

import { reclassifyHashtagTopics } from "./hashtagTopics";

reclassifyHashtagTopics()
  .then(() => {
    console.log("[ReclassifyOnce] Selesai — backlog hashtag telah diklasifikasi.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[ReclassifyOnce] Gagal:", err);
    process.exit(1);
  });
