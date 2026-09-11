import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { prisma } from "@/lib/prisma";
import type { InboxChannel } from "@prisma/client";

function channelFrom(value: string | null): InboxChannel {
  return value === "EXTRA" ? "EXTRA" : "SERVICE";
}

/**
 * Tab "Riwayat Panggilan" di /admin-xpawto - baca langsung dari CallLog (bukan menyaring
 * teks InboxMessage), lihat komentar model CallLog di schema.prisma. Nama kontak diperkaya
 * dari InboxMessage MASUK paling baru per waJid (sama seperti lib/inbox.ts) supaya tidak
 * cuma tampil nomor mentah - tetap best-effort, null kalau belum pernah tercatat.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const channel = channelFrom(req.nextUrl.searchParams.get("channel"));
  const extraAccountIdParam = req.nextUrl.searchParams.get("extraAccountId");
  const extraAccountId = extraAccountIdParam ? Number(extraAccountIdParam) : undefined;

  const rows = await prisma.callLog.findMany({
    where: channel === "EXTRA" ? { channel, extraAccountId } : { channel },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  const waJids = [...new Set(rows.filter((r) => !r.isGroup).map((r) => r.waJid))];
  const contactRows = waJids.length
    ? await prisma.inboxMessage.findMany({
        where: { waJid: { in: waJids }, direction: "INBOUND" },
        orderBy: { createdAt: "desc" },
        distinct: ["waJid"],
        select: { waJid: true, senderName: true, waNumber: true },
      })
    : [];
  const contactNameByWaJid = new Map(contactRows.filter((r) => r.senderName).map((r) => [r.waJid, r.senderName as string]));
  // Nomor HP asli dari pesan MASUK (selalu lewat senderPn, tepercaya) - dipakai menimpa
  // waNumber CallLog yang mungkin masih berupa ID internal "@lid" untuk baris LAMA (sebelum
  // resolusi di sisi bot ada). Baris baru sudah benar dari sananya (logInboxCallEvent).
  const bestNumberByWaJid = new Map(contactRows.map((r) => [r.waJid, r.waNumber]));

  return NextResponse.json({
    calls: rows.map((r) => ({
      id: r.id,
      waJid: r.waJid,
      waNumber: r.isGroup ? r.waNumber : (bestNumberByWaJid.get(r.waJid) ?? r.waNumber),
      isVideo: r.isVideo,
      isGroup: r.isGroup,
      groupName: r.groupName,
      outcome: r.outcome,
      createdAt: r.createdAt.toISOString(),
      contactName: r.isGroup ? null : (contactNameByWaJid.get(r.waJid) ?? null),
    })),
  });
}
