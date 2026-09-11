import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { prisma } from "@/lib/prisma";

const STATUS_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Status/Story warga yang masuk 24 jam terakhir (persis jendela kedaluwarsa WA asli) -
 * daftar datar terbaru dulu, BUKAN dikelompokkan per kontak (lihat komentar model
 * ContactStatusUpdate di schema.prisma soal kenapa ini cuma pencatatan pasif).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const extraAccountIdParam = req.nextUrl.searchParams.get("extraAccountId");
  const extraAccountId = extraAccountIdParam ? Number(extraAccountIdParam) : 0;
  const since = new Date(Date.now() - STATUS_WINDOW_MS);

  const rows = await prisma.contactStatusUpdate.findMany({
    where: { channel: "EXTRA", extraAccountId, postedAt: { gte: since } },
    orderBy: { postedAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    statuses: rows.map((s) => ({
      id: `s${s.id}`,
      waJid: s.waJid,
      waNumber: s.waNumber,
      contentType: s.contentType,
      text: s.text,
      attachmentUrl: s.attachmentPath ? `/api/inbox/attachment/s${s.id}` : null,
      attachmentMimeType: s.attachmentMimeType,
      postedAt: s.postedAt.toISOString(),
    })),
  });
}
