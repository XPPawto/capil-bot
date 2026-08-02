import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { startBroadcast } from "@/lib/botClient";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "empty_message" }, { status: 400 });
  }

  const recipients = await prisma.request.findMany({ distinct: ["waJid"], select: { waJid: true } });
  if (recipients.length === 0) {
    return NextResponse.json({ error: "no_recipients" }, { status: 400 });
  }

  const result = await startBroadcast(message);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "send_failed" }, { status: 502 });
  }

  await prisma.broadcast.create({
    data: { message, recipientCount: recipients.length, adminId: guard.admin.id },
  });

  return NextResponse.json({ ok: true, recipientCount: recipients.length });
}
