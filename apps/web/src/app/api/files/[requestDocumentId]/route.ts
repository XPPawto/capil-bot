import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { decryptBuffer } from "@/lib/fileEncryption";
import { prisma } from "@/lib/prisma";

const UPLOAD_DIR = path.resolve(process.cwd(), "../..", process.env.UPLOAD_DIR ?? "./storage/uploads");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ requestDocumentId: string }> }
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const { requestDocumentId } = await params;
  const docId = Number(requestDocumentId);
  if (!Number.isInteger(docId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const doc = await prisma.requestDocument.findUnique({ where: { id: docId } });
  if (!doc) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const absolutePath = path.resolve(UPLOAD_DIR, doc.filePath);
  if (!absolutePath.startsWith(UPLOAD_DIR + path.sep)) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  let rawBuffer: Buffer;
  try {
    rawBuffer = await fs.promises.readFile(absolutePath);
  } catch {
    return NextResponse.json({ error: "file_missing" }, { status: 404 });
  }

  // Berkas baru dienkripsi saat disimpan (lihat apps/bot/src/media/finalize.ts). Kalau
  // dekripsi gagal (mis. berkas lama dari sebelum fitur ini ada), anggap sudah plaintext -
  // tetap tampilkan apa adanya supaya berkas lama tidak mendadak "hilang".
  let buffer: Buffer;
  try {
    buffer = decryptBuffer(rawBuffer);
  } catch {
    buffer = rawBuffer;
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": doc.mimeType,
      "content-length": String(buffer.length),
      "content-disposition": `inline; filename="${doc.fileName}"`,
      "cache-control": "private, no-store",
    },
  });
}
