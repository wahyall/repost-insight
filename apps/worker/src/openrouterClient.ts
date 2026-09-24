import { openRouterFetch } from "./openrouterKeyRotation";

export interface EmbeddingResult {
  index: number;
  embedding: number[];
}

export class RateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number = 10) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class OpenRouterEmbeddingService {
  private model: string;
  private baseUrl: string;

  constructor(
    model: string = process.env.OPENROUTER_EMBEDDING_MODEL || "liquid/lfm-2.5-embedding-350m:free",
    baseUrl: string = "https://openrouter.ai/api/v1"
  ) {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  /**
   * Generates embeddings for an array of input strings (batch).
   * Otomatis round-robin key jika kena rate limit (FR-5.2, FR-5.4).
   */
  async generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];

    const url = `${this.baseUrl}/embeddings`;

    // openRouterFetch otomatis rotasi key jika 429/401/403
    const res = await openRouterFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "HTTP-Referer": "https://repostinsight.local",
        "X-Title": "RepostInsight",
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OpenRouter Embedding Error [${res.status}]: ${errorText}`);
    }

    const data = await res.json();
    if (!data.data || !Array.isArray(data.data)) {
      throw new Error("Format respons embedding tidak valid dari OpenRouter");
    }

    return data.data.map((item: { index: number; embedding: number[] }) => ({
      index: item.index,
      embedding: item.embedding,
    }));
  }
}
