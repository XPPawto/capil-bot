import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { prisma } from "@/lib/prisma";
import type { InboxChannel } from "@prisma/client";

interface MediaItem {
  id: string;
  attachmentUrl: string;
  attachmentMimeType: string | null;
  caption: string;
  createdAt: string;
  direction: "OUTBOUND" | "INBOUND";
}

function channelFrom(value: string | null): InboxChannel {
  return value === "EXTRA" ? "EXTRA" : "SERVICE";
}

/**
 * Galeri media satu percakapan (tombol "Media" di header thread, InboxClient.tsx) - semua
 * baris InboxMessage yang punya lampiran, TANPA harus scroll manual sepanjang riwayat chat,
 * persis panel "Media, tautan, dan dokumen" WhatsApp. RequestMessage lama TIDAK diikutkan -
 * itu jalur pra-fitur ini, lampirannya sendiri masih bisa dibuka lewat thread biasa lewat id
 * "r<id>", cuma tidak ikut terkumpul di galeri ini (kompleksitas tambahan yang tidak
 * sepadan untuk data lama yang sudah semakin jarang relevan).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ waJid: string }> }
): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const { waJid } = await params;
  const decodedWaJid = decodeURIComponent(waJid);
  const channel = channelFrom(req.nextUrl.searchParams.get("channel"));
  const extraAccountIdParam = req.nextUrl.searchParams.get("extraAccountId");
  const extraAccountId = extraAccountIdParam ? Number(extraAccountIdParam) : undefined;

  const rows = await prisma.inboxMessage.findMany({
    where: {
      waJid: decodedWaJid,
      channel,
      ...(channel === "EXTRA" ? { extraAccountId } : {}),
      attachmentPath: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const media: MediaItem[] = rows.map((m) => ({
    id: `i${m.id}`,
    attachmentUrl: `/api/inbox/attachment/i${m.id}`,
    attachmentMimeType: m.attachmentMimeType,
    caption: m.message,
    createdAt: m.createdAt.toISOString(),
    direction: m.direction,
  }));

  return NextResponse.json({ media });
}
