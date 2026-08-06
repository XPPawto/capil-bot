import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { decryptBuffer } from "@/lib/fileEncryption";
import { prisma } from "@/lib/prisma";

const UPLOAD_DIR = path.resolve(process.cwd(), "../..", process.env.UPLOAD_DIR ?? "./storage/uploads");

/**
 * Menyajikan lampiran (foto/dokumen) pada thread Pesan Masuk. Id yang dipakai sama dengan
 * skema id gabungan di ../[waJid]/messages/route.ts ("i123" = InboxMessage, "r123" =
 * RequestMessage) - satu route ini melayani lampiran dari sumber mana pun tanpa klien
 * perlu tahu tabel aslinya.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const prefix = id.charAt(0);
  const numId = Number(id.slice(1));
  if (!Number.isInteger(numId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let attachmentPath: string | null = null;
  let attachmentMimeType: string | null = null;

  if (prefix === "i") {
    const row = await prisma.inboxMessage.findUnique({ where: { id: numId } });
    attachmentPath = row?.attachmentPath ?? null;
    attachmentMimeType = row?.attachmentMimeType ?? null;
  } else if (prefix === "r") {
    const row = await prisma.requestMessage.findUnique({ where: { id: numId } });
    attachmentPath = row?.attachmentPath ?? null;
    attachmentMimeType = row?.attachmentMimeType ?? null;
  } else {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  if (!attachmentPath) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const absolutePath = path.resolve(UPLOAD_DIR, attachmentPath);
  if (!absolutePath.startsWith(UPLOAD_DIR + path.sep)) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  let rawBuffer: Buffer;
  try {
    rawBuffer = await fs.promises.readFile(absolutePath);
  } catch {
    return NextResponse.json({ error: "file_missing" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = decryptBuffer(rawBuffer);
  } catch {
    buffer = rawBuffer;
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": attachmentMimeType ?? "application/octet-stream",
      "content-length": String(buffer.length),
      "cache-control": "private, no-store",
    },
  });
}
