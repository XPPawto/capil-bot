import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { notifyReadyForPickup } from "@/lib/botClient";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const current = await prisma.request.findUnique({ where: { id } });
  if (!current) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (current.status !== "DIPROSES") {
    return NextResponse.json({ error: "invalid_status" }, { status: 409 });
  }

  await prisma.request.update({
    where: { id },
    data: { readyForPickupRequestedAt: new Date() },
  });

  await notifyReadyForPickup(id);

  return NextResponse.json({ ok: true });
}
