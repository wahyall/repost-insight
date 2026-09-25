import { prisma } from "@repostinsight/db";

/**
 * Tool 1: Semantic Search via pgvector (FR-6.2)
 * Embeds user query and searches posts by cosine similarity
 */
export async function executeSemanticSearch(query: string, limit: number = 5) {
  const safeLimit = Math.max(1, Math.min(15, limit));

  const embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL || "qwen3-embedding:0.6b";
  const baseUrl = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");

  try {
    const embedRes = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: [query],
        options: {
          num_gpu: 0,
        },
      }),
    });

    if (!embedRes.ok) {
      throw new Error(`Embedding API error: ${embedRes.status}`);
    }

    const embedJson = await embedRes.json();
    const queryVector = embedJson.embeddings?.[0];
    if (!queryVector || !Array.isArray(queryVector)) {
      throw new Error("Gagal mengekstrak embedding dari Ollama");
    }

    const vectorStr = `[${queryVector.join(",")}]`;

    // Cosine distance query with pgvector (<=> operator)
    const matchingPosts: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, owner_username, caption_text, hashtags, like_count, play_count, taken_at,
              (embedding <=> $1::vector) as distance
       FROM posts
       WHERE embedding IS NOT NULL
       ORDER BY distance ASC
       LIMIT $2;`,
      vectorStr,
      safeLimit
    );

    return {
      source: "pgvector_semantic_search",
      results: matchingPosts.map((p) => ({
        id: p.id,
        ownerUsername: p.owner_username,
        captionText: p.caption_text,
        hashtags: p.hashtags,
        likeCount: p.like_count,
        playCount: p.play_count,
        similarity: parseFloat((1 - (p.distance ?? 1)).toFixed(3)),
      })),
    };
  } catch (err) {
    console.warn("Semantic search falling back to text search due to error:", err);
    const fallbackPosts = await prisma.post.findMany({
      where: {
        captionText: { contains: query, mode: "insensitive" },
      },
      take: safeLimit,
      select: {
        id: true,
        ownerUsername: true,
        captionText: true,
        hashtags: true,
        likeCount: true,
      },
    });
    return {
      source: "keyword_fallback",
      results: fallbackPosts,
    };
  }
}

/**
 * Tool 2: Query Aggregate from Materialized Views (FR-6.3)
 */
export async function executeQueryAggregate(
  metric: "top_accounts" | "trending_hashtags" | "activity_timeline" | "summary",
  limit: number = 10
) {
  const safeLimit = Math.max(1, Math.min(30, limit));

  switch (metric) {
    case "top_accounts": {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT owner_username, repost_count, unique_followers_count, total_likes, total_plays
         FROM mv_top_reposted_accounts
         LIMIT $1;`,
        safeLimit
      );
      return {
        metric: "top_accounts",
        data: rows.map((r) => ({
          ownerUsername: r.owner_username,
          repostCount: Number(r.repost_count),
          uniqueFollowers: Number(r.unique_followers_count),
          totalLikes: Number(r.total_likes),
          totalPlays: Number(r.total_plays),
        })),
      };
    }

    case "trending_hashtags": {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT tag, usage_count, unique_reposters_count
         FROM mv_trending_hashtags
         LIMIT $1;`,
        safeLimit
      );
      return {
        metric: "trending_hashtags",
        data: rows.map((r) => ({
          hashtag: r.tag,
          count: Number(r.usage_count),
          uniqueReposters: Number(r.unique_reposters_count),
        })),
      };
    }

    case "activity_timeline": {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT activity_date, repost_count, active_followers_count
         FROM mv_repost_activity_timeline
         ORDER BY activity_date ASC
         LIMIT $1;`,
        safeLimit
      );
      return {
        metric: "activity_timeline",
        data: rows.map((r) => ({
          date: new Date(r.activity_date).toISOString().split("T")[0],
          repostCount: Number(r.repost_count),
          activeFollowers: Number(r.active_followers_count),
        })),
      };
    }

    case "summary":
    default: {
      const [totalFollowers, doneFollowers, totalPosts, totalReposts] = await Promise.all([
        prisma.follower.count(),
        prisma.follower.count({ where: { status: "done" } }),
        prisma.post.count(),
        prisma.repostEvent.count(),
      ]);
      return {
        metric: "summary",
        data: {
          totalFollowers,
          doneFollowers,
          totalPosts,
          totalReposts,
        },
      };
    }
  }
}

/**
 * Tool 3: Render Chart Generator (FR-6.4)
 */
export function executeRenderChart(
  chartType: "bar" | "line" | "area",
  title: string,
  data: { name: string; value: number }[]
) {
  return {
    isChart: true,
    chartType,
    title,
    data,
  };
}

/**
 * OpenAI / OpenRouter function tools schemas
 */
export const CHATBOT_TOOLS = [
  {
    type: "function",
    function: {
      name: "semantic_search",
      description:
        "Melakukan pencarian semantik (vektor kemiripan pgvector) terhadap isi postingan repost followers @ynsurabaya. Gunakan ini jika pengguna menanyakan topik, tema, kajian, dalil, isu, atau isi postingan tertentu.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Kata kunci atau kalimat pencarian semantik (misal: 'kajian pernikahan', 'boikot', 'nasihat sabar')",
          },
          limit: {
            type: "number",
            description: "Jumlah postingan maksimal yang diambil (default 5)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_aggregate",
      description:
        "Mengambil data statistik/analitik agregat dari materialized view database (top akun di-repost, tren hashtag, dan grafik linimasa waktu). Gunakan ini jika pengguna bertanya tentang peringkat, jumlah, statistik, akun terpopuler, atau hashtag teratas.",
      parameters: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            enum: ["top_accounts", "trending_hashtags", "activity_timeline", "summary"],
            description: "Jenis metrik agregat yang diminta",
          },
          limit: {
            type: "number",
            description: "Jumlah data yang diambil (default 10)",
          },
        },
        required: ["metric"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "render_chart",
      description:
        "Merender grafik visual interaktif (bar, line, atau area chart) langsung di bubble percakapan pengguna. Panggil tool ini setiap kali pengguna meminta grafik, visualisasi, plot, atau perbandingan chart.",
      parameters: {
        type: "object",
        properties: {
          chartType: {
            type: "string",
            enum: ["bar", "line", "area"],
            description: "Jenis grafik yang akan dirender",
          },
          title: {
            type: "string",
            description: "Judul grafik yang informatif",
          },
          data: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Label sumbu X atau kategori" },
                value: { type: "number", description: "Nilai numerik data" },
              },
              required: ["name", "value"],
            },
            description: "Daftar data poin grafik",
          },
        },
        required: ["chartType", "title", "data"],
      },
    },
  },
];
