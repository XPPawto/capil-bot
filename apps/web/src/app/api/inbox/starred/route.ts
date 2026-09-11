import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { prisma } from "@/lib/prisma";
import type { InboxChannel } from "@prisma/client";

/** Daftar "Pesan Berbintang" satu akun - lintas semua percakapan akun itu, terbaru dulu,
 * persis panel Starred Messages WA Web. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const channel: InboxChannel = req.nextUrl.searchParams.get("channel") === "EXTRA" ? "EXTRA" : "SERVICE";
  const extraAccountIdParam = req.nextUrl.searchParams.get("extraAccountId");
  const extraAccountId = extraAccountIdParam ? Number(extraAccountIdParam) : undefined;

  const rows = await prisma.inboxMessage.findMany({
    where: {
      channel,
      ...(channel === "EXTRA" ? { extraAccountId } : {}),
      starredAt: { not: null },
    },
    orderBy: { starredAt: "desc" },
    take: 200,
  });

  return NextResponse.json({
    messages: rows.map((m) => ({
      id: `i${m.id}`,
      waJid: m.waJid,
      waNumber: m.waNumber,
      message: m.message,
      createdAt: m.createdAt.toISOString(),
      starredAt: m.starredAt?.toISOString() ?? null,
      attachmentUrl: m.attachmentPath ? `/api/inbox/attachment/i${m.id}` : null,
      attachmentMimeType: m.attachmentMimeType ?? null,
      isGroup: m.isGroup,
      groupName: m.groupName,
      direction: m.direction,
    })),
  });
}
