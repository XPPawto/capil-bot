import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { prisma } from "@/lib/prisma";

/**
 * "Pesan Berbintang" ala WA - murni penanda pribadi dashboard ini, tidak pernah terkirim
 * ke WhatsApp (lihat komentar InboxMessage.starredAt di schema.prisma). `id` di sini
 * format gabungan dari GET .../messages ("i123") - RequestMessage lama ("r123") tidak
 * pernah bisa dibintangi (tidak punya kolom starredAt sama sekali).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ waJid: string }> }
): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  await params; // waJid tidak dipakai langsung (id pesan sudah unik global) - tetap divalidasi via guard di atas
  const body = await req.json().catch(() => ({}));
  const rawId = typeof body?.id === "string" ? body.id : "";
  const starred = Boolean(body?.starred);
  const match = /^i(\d+)$/.exec(rawId);
  if (!match) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  await prisma.inboxMessage.update({
    where: { id: Number(match[1]) },
    data: { starredAt: starred ? new Date() : null },
  });
  return NextResponse.json({ ok: true });
}
