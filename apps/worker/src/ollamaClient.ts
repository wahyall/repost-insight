export interface EmbeddingResult {
  index: number;
  embedding: number[];
}

export class OllamaEmbeddingService {
  private model: string;
  private baseUrl: string;

  constructor(
    model: string = process.env.OLLAMA_EMBEDDING_MODEL || "qwen3-embedding:0.6b",
    baseUrl: string = process.env.OLLAMA_BASE_URL || "http://localhost:11434"
  ) {
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /**
   * Generates 1024-dimensional embeddings for an array of input strings (batch).
   * Menjalankan inferensi lokal via Ollama API (/api/embed) tanpa batasan kuota/rate limit.
   */
  async generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];

    const url = `${this.baseUrl}/api/embed`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        options: {
          num_gpu: 0, // Gunakan CPU inferensi untuk memastikan stabilitas di GPU Pascal (GTX 1050 Ti)
        },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Ollama Embedding Error [${res.status}]: ${errorText}`);
    }

    const data = await res.json();
    if (!data.embeddings || !Array.isArray(data.embeddings)) {
      throw new Error("Format respons embedding tidak valid dari Ollama");
    }

    return data.embeddings.map((emb: number[], index: number) => ({
      index,
      embedding: emb,
    }));
  }
}
