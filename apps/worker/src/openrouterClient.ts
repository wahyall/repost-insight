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
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(
    apiKey: string = process.env.OPENROUTER_API_KEY || "",
    model: string = process.env.OPENROUTER_EMBEDDING_MODEL || "liquid/lfm-2.5-embedding-350m:free",
    baseUrl: string = "https://openrouter.ai/api/v1"
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  /**
   * Generates embeddings for an array of input strings (batch)
   * (FR-5.2, FR-5.4)
   */
  async generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
    if (!this.apiKey) {
      throw new Error("OPENROUTER_API_KEY belum disetel di file environment (.env).");
    }

    if (texts.length === 0) return [];

    const url = `${this.baseUrl}/embeddings`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://repostinsight.local",
        "X-Title": "RepostInsight",
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (res.status === 429) {
      const retryHeader = res.headers.get("Retry-After");
      const retrySec = retryHeader ? parseInt(retryHeader, 10) : 10;
      throw new RateLimitError(`OpenRouter Rate Limit (HTTP 429). Coba lagi dalam ${retrySec}s.`, isNaN(retrySec) ? 10 : retrySec);
    }

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
