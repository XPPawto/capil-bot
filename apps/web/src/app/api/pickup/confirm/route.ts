import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { notifyStatusChange } from "@/lib/botClient";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => ({}));
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  if (!requestId) {
    return NextResponse.json({ error: "missing_request_id" }, { status: 400 });
  }

  const now = new Date();
  const success = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.request.updateMany({
      where: { id: requestId, status: "DIPROSES", pickupTokenUsedAt: null },
      data: { status: "SELESAI", pickupTokenUsedAt: now, pickupConfirmedAt: now, completedAt: now },
    });
    if (updateResult.count === 0) return false;

    await tx.statusHistory.create({
      data: {
        requestId,
        status: "SELESAI",
        note: "Diambil di kantor (scan QR)",
        changedById: guard.admin.id,
      },
    });
    return true;
  });

  if (!success) {
    return NextResponse.json({ error: "conflict" }, { status: 409 });
  }

  await notifyStatusChange(requestId);

  return NextResponse.json({ ok: true });
}
