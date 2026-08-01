import { NextRequest, NextResponse } from "next/server";
import type { RequestStatus } from "@kelurahan/db";
import { requireAdmin } from "@/lib/apiGuard";
import { notifyStatusChange } from "@/lib/botClient";
import { prisma } from "@/lib/prisma";

const ALLOWED_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  DICEK: ["DIPROSES", "DITOLAK"],
  DIPROSES: ["SELESAI", "DITOLAK"],
  DITOLAK: [],
  SELESAI: [],
};

const TARGETABLE_STATUSES: RequestStatus[] = ["DIPROSES", "DITOLAK", "SELESAI"];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const nextStatus = body?.status as RequestStatus | undefined;
  const note: string | undefined = typeof body?.note === "string" ? body.note.trim() : undefined;

  if (!nextStatus || !TARGETABLE_STATUSES.includes(nextStatus)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }
  if (nextStatus === "DITOLAK" && !note) {
    return NextResponse.json({ error: "reason_required" }, { status: 400 });
  }

  const current = await prisma.request.findUnique({ where: { id } });
  if (!current) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(nextStatus)) {
    return NextResponse.json({ error: "invalid_transition" }, { status: 409 });
  }

  // updateMany + cek count: mencegah dua petugas mengubah status bersamaan dari state yang sama.
  const result = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.request.updateMany({
      where: { id, status: current.status },
      data: {
        status: nextStatus,
        rejectionReason: nextStatus === "DITOLAK" ? note : current.rejectionReason,
        pickupConfirmedAt: nextStatus === "SELESAI" ? new Date() : current.pickupConfirmedAt,
        completedAt: nextStatus === "SELESAI" ? new Date() : current.completedAt,
      },
    });

    if (updateResult.count === 0) return false;

    await tx.statusHistory.create({
      data: { requestId: id, status: nextStatus, note, changedById: guard.admin.id },
    });
    return true;
  });

  if (!result) {
    return NextResponse.json({ error: "conflict" }, { status: 409 });
  }

  await notifyStatusChange(id);

  return NextResponse.json({ ok: true });
}
