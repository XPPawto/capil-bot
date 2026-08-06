import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { sendInboxReply } from "@/lib/botClient";
import { prisma } from "@/lib/prisma";
import type { InboxChannel } from "@prisma/client";

interface ThreadMessage {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  message: string;
  createdAt: string;
  adminName: string | null;
  attachmentUrl: string | null;
  attachmentMimeType: string | null;
  senderName: string | null;
  senderNumber: string | null;
  editedAt: string | null;
  status: string | null;
}

function channelFrom(value: string | null): InboxChannel {
  return value === "EXTRA" ? "EXTRA" : "SERVICE";
}

/**
 * Dipoll berkala oleh halaman Pesan Masuk. Untuk channel SERVICE, menggabungkan dua sumber:
 * InboxMessage (semua pesan mentah sejak fitur ini ada) dan RequestMessage (percakapan bebas
 * lama yang terjadi selagi warga punya Request aktif, dari sebelum fitur ini dibangun) -
 * supaya histori yang MEMANG pernah tersimpan tetap kelihatan utuh. Channel EXTRA (akun
 * ekstra, bukan bot) tidak pernah punya Request sama sekali, jadi cukup InboxMessage saja -
 * tapi WAJIB disaring per `extraAccountId` (bisa ada beberapa akun ekstra sekaligus).
 * ?since=<ISO date> membatasi ke pesan yang lebih baru dari yang sudah dipegang klien.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ waJid: string }> }
): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const { waJid } = await params;
  const decodedWaJid = decodeURIComponent(waJid);
  const since = req.nextUrl.searchParams.get("since");
  const sinceDate = since ? new Date(since) : undefined;
  const channel = channelFrom(req.nextUrl.searchParams.get("channel"));
  const extraAccountIdParam = req.nextUrl.searchParams.get("extraAccountId");
  const extraAccountId = extraAccountIdParam ? Number(extraAccountIdParam) : undefined;

  const [inboxRows, requestRows] = await Promise.all([
    prisma.inboxMessage.findMany({
      where: {
        waJid: decodedWaJid,
        channel,
        ...(channel === "EXTRA" ? { extraAccountId } : {}),
        ...(sinceDate ? { createdAt: { gt: sinceDate } } : {}),
      },
      orderBy: { createdAt: "asc" },
      include: { admin: true },
    }),
    channel === "SERVICE"
      ? prisma.requestMessage.findMany({
          where: {
            request: { waJid: decodedWaJid },
            ...(sinceDate ? { createdAt: { gt: sinceDate } } : {}),
          },
          orderBy: { createdAt: "asc" },
          include: { admin: true },
        })
      : Promise.resolve([]),
  ]);

  const messages: ThreadMessage[] = [
    ...inboxRows.map((m) => ({
      id: `i${m.id}`,
      direction: m.direction,
      message: m.message,
      createdAt: m.createdAt.toISOString(),
      adminName: m.admin?.name ?? null,
      attachmentUrl: m.attachmentPath ? `/api/inbox/attachment/i${m.id}` : null,
      attachmentMimeType: m.attachmentMimeType ?? null,
      senderName: m.senderName ?? null,
      senderNumber: m.senderNumber ?? null,
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      status: m.status ?? null,
    })),
    ...requestRows.map((m) => ({
      id: `r${m.id}`,
      direction: m.direction,
      message: m.message,
      createdAt: m.createdAt.toISOString(),
      adminName: m.admin?.name ?? null,
      attachmentUrl: m.attachmentPath ? `/api/inbox/attachment/r${m.id}` : null,
      attachmentMimeType: m.attachmentMimeType ?? null,
      senderName: null,
      senderNumber: null,
      editedAt: null,
      status: null,
    })),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return NextResponse.json({ messages });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ waJid: string }> }
): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const { waJid } = await params;
  const decodedWaJid = decodeURIComponent(waJid);
  const body = await req.json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const channel = channelFrom(typeof body?.channel === "string" ? body.channel : null);
  const extraAccountId = body?.extraAccountId ? Number(body.extraAccountId) : undefined;
  if (!message) {
    return NextResponse.json({ error: "empty_message" }, { status: 400 });
  }

  // Wajib ambil alih dulu - tapi HANYA untuk nomor layanan (ada bot yang bisa dialihkan
  // dari mode otomatis). Akun ekstra tidak punya balasan otomatis sama sekali, jadi bisa
  // langsung dibalas kapan saja.
  if (channel === "SERVICE") {
    const takeover = await prisma.humanTakeover.findUnique({ where: { waJid: decodedWaJid } });
    if (!takeover) {
      return NextResponse.json({ error: "takeover_required" }, { status: 409 });
    }
  }

  // waNumber diutamakan dari pesan MASUK (selalu benar, lewat senderPn) - kalau diambil
  // dari baris apa pun tanpa pilih-pilih, bisa kejaring baris balasan-dari-HP lama yang
  // JID-nya di-mask WhatsApp ("@lid") dan waNumber-nya keliru (ID internal, bukan nomor HP).
  let waNumber: string | undefined;
  const inboundInbox = await prisma.inboxMessage.findFirst({
    where: { waJid: decodedWaJid, direction: "INBOUND" },
    orderBy: { createdAt: "desc" },
  });
  waNumber = inboundInbox?.waNumber;
  if (!waNumber) {
    const existingRequest = await prisma.request.findFirst({ where: { waJid: decodedWaJid } });
    waNumber = existingRequest?.waNumber;
  }
  if (!waNumber) {
    const anyInbox = await prisma.inboxMessage.findFirst({ where: { waJid: decodedWaJid } });
    waNumber = anyInbox?.waNumber;
  }
  if (!waNumber) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Kirim dulu, baru catat - urutan ini juga dipakai ../send-file/route.ts. Selain lebih
  // konsisten, ini butuh ID pesan WA hasil pengiriman (waMessageId) supaya messages.update
  // (status centang) nanti bisa menemukan baris yang tepat untuk diperbarui.
  const sent = await sendInboxReply(decodedWaJid, message, channel, extraAccountId);
  if (!sent.ok) {
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  await prisma.inboxMessage.create({
    data: {
      waJid: decodedWaJid,
      waNumber,
      channel,
      extraAccountId,
      direction: "OUTBOUND",
      message,
      adminId: guard.admin.id,
      waMessageId: sent.waMessageId,
      status: sent.waMessageId ? "SENT" : undefined,
    },
  });

  return NextResponse.json({ ok: true });
}
