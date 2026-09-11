import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { upsertConversationState } from "@/lib/inbox";
import type { InboxChannel } from "@prisma/client";

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
  const archived = Boolean(body?.archived);

  await upsertConversationState(decodedWaJid, channel, extraAccountId, { archivedAt: archived ? new Date() : null });
  return NextResponse.json({ ok: true });
}
