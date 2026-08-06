import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { sendInboxReply } from "@/lib/botClient";
import { prisma } from "@/lib/prisma";

interface ThreadMessage {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  message: string;
  createdAt: string;
  adminName: string | null;
}

/**
 * Dipoll berkala oleh halaman Pesan Masuk. Menggabungkan dua sumber: InboxMessage (semua
 * pesan mentah sejak fitur ini ada) dan RequestMessage (percakapan bebas lama yang terjadi
 * selagi warga punya Request aktif, dari sebelum fitur ini dibangun) - supaya histori yang
 * MEMANG pernah tersimpan tetap kelihatan utuh, bukan cuma yang baru. ?since=<ISO date>
 * membatasi ke pesan yang lebih baru dari yang sudah dipegang klien.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ waJid: string }> }
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const { waJid } = await params;
  const decodedWaJid = decodeURIComponent(waJid);
  const since = req.nextUrl.searchParams.get("since");
  const sinceDate = since ? new Date(since) : undefined;

  const [inboxRows, requestRows] = await Promise.all([
    prisma.inboxMessage.findMany({
      where: { waJid: decodedWaJid, ...(sinceDate ? { createdAt: { gt: sinceDate } } : {}) },
      orderBy: { createdAt: "asc" },
      include: { admin: true },
    }),
    prisma.requestMessage.findMany({
      where: {
        request: { waJid: decodedWaJid },
        ...(sinceDate ? { createdAt: { gt: sinceDate } } : {}),
      },
      orderBy: { createdAt: "asc" },
      include: { admin: true },
    }),
  ]);

  const messages: ThreadMessage[] = [
    ...inboxRows.map((m) => ({
      id: `i${m.id}`,
      direction: m.direction,
      message: m.message,
      createdAt: m.createdAt.toISOString(),
      adminName: m.admin?.name ?? null,
    })),
    ...requestRows.map((m) => ({
      id: `r${m.id}`,
      direction: m.direction,
      message: m.message,
      createdAt: m.createdAt.toISOString(),
      adminName: m.admin?.name ?? null,
    })),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return NextResponse.json({ messages });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ waJid: string }> }
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const { waJid } = await params;
  const decodedWaJid = decodeURIComponent(waJid);
  const body = await req.json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "empty_message" }, { status: 400 });
  }

  // Wajib ambil alih dulu - sama seperti chat di halaman detail pengajuan, supaya bot
  // tidak ikut auto-reply ke nomor ini bersamaan dengan balasan manual petugas.
  const takeover = await prisma.humanTakeover.findUnique({ where: { waJid: decodedWaJid } });
  if (!takeover) {
    return NextResponse.json({ error: "takeover_required" }, { status: 409 });
  }

  // waNumber diambil dari sumber mana pun yang sudah ada catatannya untuk waJid ini.
  const existingInbox = await prisma.inboxMessage.findFirst({ where: { waJid: decodedWaJid } });
  const existingRequest = existingInbox
    ? null
    : await prisma.request.findFirst({ where: { waJid: decodedWaJid } });
  const waNumber = existingInbox?.waNumber ?? existingRequest?.waNumber;
  if (!waNumber) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await prisma.inboxMessage.create({
    data: { waJid: decodedWaJid, waNumber, direction: "OUTBOUND", message, adminId: guard.admin.id },
  });

  const sent = await sendInboxReply(decodedWaJid, message);
  if (!sent) {
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
