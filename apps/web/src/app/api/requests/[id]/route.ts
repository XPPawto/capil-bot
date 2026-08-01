import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { prisma } from "@/lib/prisma";

const UPLOAD_DIR = path.resolve(process.cwd(), "../..", process.env.UPLOAD_DIR ?? "./storage/uploads");

const DELETABLE_STATUSES = ["DITOLAK", "SELESAI"];

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const request = await prisma.request.findUnique({ where: { id } });
  if (!request) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!DELETABLE_STATUSES.includes(request.status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 409 });
  }

  // Hapus baris DB dulu (cascade ke RequestDocument & StatusHistory), baru hapus
  // folder fisiknya - urutan ini menjamin tidak ada RequestDocument yang menunjuk
  // ke file yang sudah tidak ada kalau proses terhenti di tengah jalan.
  await prisma.request.delete({ where: { id } });

  const dir = path.resolve(UPLOAD_DIR, id);
  if (dir.startsWith(UPLOAD_DIR + path.sep)) {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }

  return NextResponse.json({ ok: true });
}
