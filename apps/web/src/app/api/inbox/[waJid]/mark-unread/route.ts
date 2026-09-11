import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { upsertConversationState } from "@/lib/inbox";
import type { InboxChannel } from "@prisma/client";

/**
 * "Tandai belum dibaca" manual ala WA Web - independen dari badge "belum dibalas" bawaan
 * (yang dihitung dari arah pesan terakhir). Dibersihkan otomatis begitu admin membuka
 * percakapan ini lagi - lihat GET .../messages/route.ts.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ waJid: string }> }
): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const { waJid } = await params;
  const decodedWaJid = decodeURIComponent(waJid);
  const body = await req.json().catch(() => ({}));
  const channel: InboxChannel = body?.channel === "EXTRA" ? "EXTRA" : "SERVICE";
  const extraAccountId = body?.extraAccountId ? Number(body.extraAccountId) : undefined;
  const unread = Boolean(body?.unread);

  await upsertConversationState(decodedWaJid, channel, extraAccountId, { manualUnreadAt: unread ? new Date() : null });
  return NextResponse.json({ ok: true });
}
