import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { notifyTakeover } from "@/lib/botClient";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const active = Boolean(body?.active);

  const request = await prisma.request.findUnique({ where: { id } });
  if (!request) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (active) {
    await prisma.humanTakeover.upsert({
      where: { waJid: request.waJid },
      update: { activatedAt: new Date(), adminId: guard.admin.id },
      create: { waJid: request.waJid, adminId: guard.admin.id },
    });
  } else {
    await prisma.humanTakeover.deleteMany({ where: { waJid: request.waJid } });
  }

  const notified = await notifyTakeover(request.waJid, active);

  return NextResponse.json({ ok: true, active, notified });
}
