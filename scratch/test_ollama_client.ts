import { OllamaEmbeddingService } from "../apps/worker/src/ollamaClient";

async function main() {
  const service = new OllamaEmbeddingService();
  console.log("Testing OllamaEmbeddingService.generateEmbeddings...");
  const results = await service.generateEmbeddings([
    "Kajian fiqih muamalah dan adab menuntut ilmu di Surabaya",
    "Tips menjaga keistiqomahan dalam beribadah",
  ]);

  console.log("Result length:", results.length);
  console.log("Item 0 index:", results[0].index, "dim:", results[0].embedding.length);
  console.log("Item 1 index:", results[1].index, "dim:", results[1].embedding.length);
}

main().catch(console.error);
