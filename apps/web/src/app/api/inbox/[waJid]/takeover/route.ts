import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { notifyTakeover } from "@/lib/botClient";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ waJid: string }> }
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const { waJid } = await params;
  const decodedWaJid = decodeURIComponent(waJid);
  const body = await req.json().catch(() => ({}));
  const active = Boolean(body?.active);

  if (active) {
    await prisma.humanTakeover.upsert({
      where: { waJid: decodedWaJid },
      update: { activatedAt: new Date(), adminId: guard.admin.id },
      create: { waJid: decodedWaJid, adminId: guard.admin.id },
    });
  } else {
    await prisma.humanTakeover.deleteMany({ where: { waJid: decodedWaJid } });
  }

  const notified = await notifyTakeover(decodedWaJid, active);

  return NextResponse.json({ ok: true, active, notified });
}
