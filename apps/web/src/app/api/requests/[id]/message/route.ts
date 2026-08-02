import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { sendCustomMessage } from "@/lib/botClient";
import { prisma } from "@/lib/prisma";

/**
 * Dipoll berkala oleh MessageThread di halaman detail supaya balasan warga dari WA
 * muncul tanpa petugas harus refresh manual. ?since=<ISO date> membatasi hasil ke
 * pesan yang lebih baru dari pesan terakhir yang sudah dipegang klien.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const since = req.nextUrl.searchParams.get("since");

  const messages = await prisma.requestMessage.findMany({
    where: {
      requestId: id,
      ...(since ? { createdAt: { gt: new Date(since) } } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: { admin: true },
  });

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      message: m.message,
      createdAt: m.createdAt.toISOString(),
      adminName: m.admin?.name ?? null,
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "empty_message" }, { status: 400 });
  }

  const request = await prisma.request.findUnique({ where: { id } });
  if (!request) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await prisma.requestMessage.create({
    data: { requestId: id, direction: "OUTBOUND", message, adminId: guard.admin.id },
  });

  const sent = await sendCustomMessage(id, message);
  if (!sent) {
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
