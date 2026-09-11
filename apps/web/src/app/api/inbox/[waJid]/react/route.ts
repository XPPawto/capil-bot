import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { sendInboxReaction } from "@/lib/botClient";
import type { InboxChannel } from "@prisma/client";

function channelFrom(value: string | null): InboxChannel {
  return value === "EXTRA" ? "EXTRA" : "SERVICE";
}

/**
 * Reaksi emoji ke pesan warga dari dashboard - beneran terkirim ke WA (bukan cuma
 * kosmetik di sini), lihat lib/botClient.ts. Tidak mensyaratkan "Ambil Alih" seperti
 * mengirim pesan - reaksi tidak pernah bentrok dengan alur otomatis bot (bot tidak
 * pernah bereaksi ke pesan apa pun), jadi aman dipakai kapan saja.
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
  const waMessageId = typeof body?.waMessageId === "string" ? body.waMessageId : "";
  const fromMe = Boolean(body?.fromMe);
  const participant = typeof body?.participant === "string" ? body.participant : undefined;
  const emoji = typeof body?.emoji === "string" ? body.emoji : "";
  const channel = channelFrom(typeof body?.channel === "string" ? body.channel : null);
  const extraAccountId = body?.extraAccountId ? Number(body.extraAccountId) : undefined;
  if (!waMessageId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const sent = await sendInboxReaction(decodedWaJid, waMessageId, fromMe, emoji, channel, extraAccountId, participant);
  if (!sent.ok) {
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
