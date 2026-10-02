import path from "path";
import dotenv from "dotenv";

// Same env-loading order as index.ts: worker .env first, then root .env with override
dotenv.config();
const rootEnvPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: rootEnvPath, override: true });

import { classifyPostTopics } from "./postTopics";

classifyPostTopics()
  .then(() => {
    console.log("[ClassifyOnce] Selesai — backlog topic_label post telah diklasifikasi.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[ClassifyOnce] Gagal:", err);
    process.exit(1);
  });
