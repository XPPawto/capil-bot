import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
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

  let buffer: Buffer;
  try {
    buffer = await fs.promises.readFile(absolutePath);
  } catch {
    return NextResponse.json({ error: "file_missing" }, { status: 404 });
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
