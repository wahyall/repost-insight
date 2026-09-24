# RepostInsight — Project Structure

| | |
|---|---|
| **Dokumen** | Project Structure |
| **Proyek** | RepostInsight |
| **Versi** | 1.1 (dipisah dari dokumen gabungan) |
| **Tanggal** | 24 September 2026 |

Rujukan spesifikasi fungsional & data model: `SRS.md`. Rujukan urutan pengerjaan: `GRAND_PLAN.md`.

## 1. Struktur Monorepo

```
repostinsight/
├── apps/
│   ├── web/                          # Next.js — dashboard, chat UI, settings, auth
│   │   ├── app/
│   │   │   ├── (auth)/
│   │   │   │   └── login/
│   │   │   │       └── page.tsx
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx
│   │   │   ├── chat/
│   │   │   │   └── page.tsx
│   │   │   ├── settings/
│   │   │   │   ├── followers/
│   │   │   │   │   └── page.tsx      # upload/re-import + status followers
│   │   │   │   └── apify-keys/
│   │   │   │       └── page.tsx      # manajemen multi API-key
│   │   │   └── api/
│   │   │       ├── followers/
│   │   │       │   ├── import/route.ts
│   │   │       │   └── [username]/retry/route.ts
│   │   │       ├── scrape-control/
│   │   │       │   ├── pause/route.ts
│   │   │       │   └── resume/route.ts
│   │   │       ├── apify-keys/
│   │   │       │   ├── route.ts
│   │   │       │   └── [id]/route.ts
│   │   │       ├── dashboard/
│   │   │       │   └── summary/route.ts
│   │   │       └── chat/
│   │   │           ├── route.ts
│   │   │           └── history/route.ts
│   │   ├── components/
│   │   │   ├── dashboard/            # chart komponen (Recharts)
│   │   │   ├── chat/                 # bubble chat, chart-inline renderer
│   │   │   └── settings/
│   │   ├── lib/
│   │   │   ├── auth.ts               # NextAuth config
│   │   │   └── tools/                # definisi tool chatbot: semantic_search, query_aggregate, render_chart
│   │   ├── middleware.ts             # proteksi seluruh route
│   │   └── package.json
│   └── worker/                       # Proses Node.js terpisah
│       ├── src/
│       │   ├── scrapeLoop.ts         # FR-2.x
│       │   ├── keyRotation.ts        # FR-3.x
│       │   ├── embeddingLoop.ts      # FR-5.x
│       │   ├── apifyClient.ts
│       │   ├── openrouterClient.ts
│       │   └── index.ts              # entrypoint: jalankan scrapeLoop + embeddingLoop
│       └── package.json
├── packages/
│   └── db/                           # Prisma schema, dipakai bareng web & worker
│       ├── prisma/
│       │   └── schema.prisma
│       ├── index.ts                  # export PrismaClient singleton
│       └── package.json
├── docs/                             # 5 dokumen perencanaan (BRD, PRD, SRS, ini, GRAND_PLAN)
│   ├── BRD.md
│   ├── PRD.md
│   ├── SRS.md
│   ├── PROJECT_STRUCTURE.md
│   └── GRAND_PLAN.md
├── docker-compose.yml                 # Container Postgres+pgvector
├── .env.example
├── package.json                       # root, workspace config
└── README.md
```

## 2. Tech Stack Final

| Layer | Pilihan |
|---|---|
| Frontend & API | Next.js (App Router) + TypeScript + Tailwind |
| Chart dashboard | Recharts |
| Chat UI | Vercel AI SDK langsung, atau CopilotKit (opsional, untuk generative UI grafik) |
| ORM & DB | Prisma + PostgreSQL 16 + pgvector |
| Worker | Node.js script mandiri (tsx), tanpa Redis/BullMQ |
| Auth | NextAuth (Credentials Provider) |
| Scraping | `apify-client` (SDK resmi Apify) |
| LLM & Embedding | OpenRouter (`@ai-sdk/openai` dengan `baseURL` OpenRouter) |
| Infrastruktur lokal | Docker (khusus container Postgres) |
| Package manager | pnpm (workspace monorepo) — bisa diganti npm/yarn sesuai preferensi |

## 3. Prisma Schema Lengkap

```prisma
// packages/db/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector]
}

model Follower {
  username      String   @id
  status        String   @default("pending") // pending/in_progress/done/failed
  apifyRunId    String?  @map("apify_run_id")
  lastScrapedAt DateTime? @map("last_scraped_at")
  retryCount    Int      @default(0) @map("retry_count")
  createdAt     DateTime @default(now()) @map("created_at")
  repostEvents  RepostEvent[]

  @@map("followers")
}

model Post {
  id              String   @id
  code            String?
  ownerUsername   String?  @map("owner_username")
  captionText     String?  @map("caption_text")
  hashtags        String[]
  mediaType       String?  @map("media_type")
  likeCount       Int?     @map("like_count")
  playCount       Int?     @map("play_count")
  takenAt         DateTime? @map("taken_at")
  rawJson         Json?    @map("raw_json")
  embeddingStatus String   @default("pending") @map("embedding_status")
  firstSeenAt     DateTime @default(now()) @map("first_seen_at")
  lastUpdatedAt   DateTime @default(now()) @updatedAt @map("last_updated_at")
  repostEvents    RepostEvent[]

  @@map("posts")
  // kolom `embedding vector(1024)` ditambahkan lewat migration SQL manual,
  // Prisma belum punya native type pgvector di semua versi — lihat catatan §4
}

model RepostEvent {
  id                Int      @id @default(autoincrement())
  followerUsername  String   @map("follower_username")
  postId            String   @map("post_id")
  scrapedAt         DateTime @default(now()) @map("scraped_at")
  follower          Follower @relation(fields: [followerUsername], references: [username])
  post              Post     @relation(fields: [postId], references: [id])

  @@unique([followerUsername, postId])
  @@map("repost_events")
}

model ApifyApiKey {
  id                 Int       @id @default(autoincrement())
  label              String?
  token              String
  status             String    @default("active") // active/exhausted/invalid
  monthlyUsageUsd    Decimal?  @map("monthly_usage_usd")
  maxMonthlyUsageUsd Decimal?  @map("max_monthly_usage_usd")
  usageCycleEndsAt   DateTime? @map("usage_cycle_ends_at")
  lastCheckedAt      DateTime? @map("last_checked_at")
  lastUsedAt         DateTime? @map("last_used_at")
  createdAt          DateTime  @default(now()) @map("created_at")

  @@map("apify_api_keys")
}

model ScrapeControl {
  id             Int     @id @default(1)
  isPaused       Boolean @default(false) @map("is_paused")
  pauseReason    String? @map("pause_reason")
  maxConcurrency Int     @default(3) @map("max_concurrency")

  @@map("scrape_control")
}

model ChatMessage {
  id        Int      @id @default(autoincrement())
  role      String
  content   String?
  toolCalls Json?    @map("tool_calls")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("chat_messages")
}
```

## 4. Catatan Setup Database (pgvector)

Karena dukungan native pgvector di Prisma bervariasi antar versi, kolom `embedding vector(1024)` pada tabel `posts` sebaiknya ditambahkan lewat migration SQL manual setelah `prisma migrate dev`, contoh:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE posts ADD COLUMN embedding vector(1024);
```

## 5. Konvensi Penamaan & Kode

- **File & folder**: `kebab-case` untuk folder route Next.js, `camelCase.ts` untuk file logic, `PascalCase.tsx` untuk komponen React.
- **Database**: nama tabel & kolom `snake_case` (sudah tercermin di `@map()` pada schema Prisma di atas), model Prisma `PascalCase`.
- **Status enum** (string, bukan Prisma enum, agar gampang di-extend): selalu lowercase (`pending`, `in_progress`, `done`, `failed`, `active`, `exhausted`, `invalid`).
- **Commit message**: bebas, tidak ada konvensi ketat mengingat single-developer, tapi disarankan menyebut nomor fase (`fase-2: tambah tabel apify_api_keys`) agar mudah ditelusuri sesuai `GRAND_PLAN.md`.

## 6. Environment Variables

```env
# .env.example
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/repostinsight
APIFY_ACTOR_ID=data-slayer~instagram-reposts
OPENROUTER_API_KEY=
AUTH_USERNAME=wahyu
AUTH_PASSWORD_HASH=
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
```

Catatan: token Apify **tidak** disimpan di `.env` — dikelola dinamis lewat tabel `apify_api_keys` karena jumlahnya banyak dan perlu ditambah/dicabut lewat UI (lihat SRS §3 F3).

## 7. docker-compose.yml

```yaml
services:
  db:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: repostinsight
    ports:
      - "5432:5432"
    volumes:
      - repostinsight_pgdata:/var/lib/postgresql/data
    # batasi resource mengingat RAM laptop 8GB (lihat SRS §8)
    deploy:
      resources:
        limits:
          memory: 1g

volumes:
  repostinsight_pgdata:
```

## 8. Root package.json (workspace, contoh)

```json
{
  "name": "repostinsight",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "pnpm --filter web dev",
    "build": "pnpm --filter web build",
    "start": "pnpm --filter web start",
    "worker": "pnpm --filter worker start",
    "db:migrate": "pnpm --filter db exec prisma migrate dev",
    "db:studio": "pnpm --filter db exec prisma studio"
  }
}
```
