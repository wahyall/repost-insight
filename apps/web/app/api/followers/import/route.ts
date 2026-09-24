import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@repostinsight/db";
import { extractUsernamesFromJson } from "@/lib/followers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    let rawText = "";
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");

      if (!file || !(file instanceof Blob)) {
        return NextResponse.json(
          { error: "File tidak ditemukan dalam request form-data (gunakan field 'file')" },
          { status: 400 }
        );
      }

      rawText = await file.text();
    } else if (contentType.includes("application/json")) {
      rawText = await req.text();
    } else {
      // Fallback try reading as text
      rawText = await req.text();
    }

    if (!rawText || rawText.trim().length === 0) {
      return NextResponse.json(
        { error: "File atau payload kosong" },
        { status: 400 }
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      return NextResponse.json(
        { error: "Format file tidak valid: Gagal mem-parse JSON. Pastikan file berformat JSON yang valid." },
        { status: 400 }
      );
    }

    const rawUsernames = extractUsernamesFromJson(parsedJson);

    if (rawUsernames.length === 0) {
      return NextResponse.json(
        {
          error:
            "Format data tidak sesuai: Tidak ditemukan daftar username Instagram. Pastikan file mengikuti format export resmi Instagram (string_list_data[].value) atau list username.",
        },
        { status: 400 }
      );
    }

    // Normalisasi & dedup lokal di dalam file
    const uniqueMap = new Map<string, string>();
    for (const u of rawUsernames) {
      const clean = u.trim().toLowerCase();
      if (clean && !uniqueMap.has(clean)) {
        uniqueMap.set(clean, clean);
      }
    }

    const uniqueUsernames = Array.from(uniqueMap.values());
    const totalInFile = uniqueUsernames.length;

    // Chunked insert using createMany with skipDuplicates: true (find-or-create)
    const CHUNK_SIZE = 1000;
    let totalInserted = 0;

    for (let i = 0; i < uniqueUsernames.length; i += CHUNK_SIZE) {
      const chunk = uniqueUsernames.slice(i, i + CHUNK_SIZE);
      const dataToInsert = chunk.map((username) => ({
        username,
        status: "pending",
        retryCount: 0,
      }));

      const res = await prisma.follower.createMany({
        data: dataToInsert,
        skipDuplicates: true,
      });

      totalInserted += res.count;
    }

    const totalExisting = totalInFile - totalInserted;

    return NextResponse.json({
      success: true,
      summary: {
        totalInFile,
        newFollowers: totalInserted,
        alreadyExisting: totalExisting,
      },
      message: `Berhasil mengimpor: ${totalInserted} follower baru ditambahkan, ${totalExisting} follower sudah ada sebelumnya (tidak direset).`,
    });
  } catch (err: unknown) {
    console.error("[API] Error import followers:", err);
    return NextResponse.json(
      {
        error: "Terjadi kesalahan internal saat memproses import followers",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
