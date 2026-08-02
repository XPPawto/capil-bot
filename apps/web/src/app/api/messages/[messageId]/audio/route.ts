import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { decryptBuffer } from "@/lib/fileEncryption";
import { prisma } from "@/lib/prisma";

const UPLOAD_DIR = path.resolve(process.cwd(), "../..", process.env.UPLOAD_DIR ?? "./storage/uploads");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const { messageId } = await params;
  const id = Number(messageId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const message = await prisma.requestMessage.findUnique({ where: { id } });
  if (!message || !message.attachmentPath) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const absolutePath = path.resolve(UPLOAD_DIR, message.attachmentPath);
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
      "content-type": message.attachmentMimeType ?? "audio/ogg",
      "content-length": String(buffer.length),
      "cache-control": "private, no-store",
    },
  });
}
