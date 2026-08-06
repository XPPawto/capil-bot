import { prisma } from "@/lib/prisma";
import type { InboxChannel } from "@prisma/client";

export interface InboxConversation {
  waJid: string;
  waNumber: string;
  lastMessage: string;
  lastDirection: "INBOUND" | "OUTBOUND";
  lastAt: string;
  takeoverActive: boolean;
  isGroup: boolean;
  groupName: string | null;
  lastSenderName: string | null;
}

/**
 * Kotak masuk cuma mulai mencatat SEMUA pesan mentah (InboxMessage) sejak fitur ini
 * di-deploy - WhatsApp/Baileys tidak punya cara menarik ulang histori chat lama secara
 * andal (history sync bawaan Baileys cuma jalan sekali saat perangkat BARU ditautkan lewat
 * QR, sengaja dimatikan di proyek ini karena berat & tidak reliabel, dan tidak berlaku
 * surut untuk sesi yang sudah lama tertaut).
 *
 * Untuk histori SEBELUM fitur ini ada, satu-satunya teks asli yang pernah benar-benar
 * tersimpan adalah percakapan bebas yang terjadi selagi seseorang punya Request aktif
 * (tabel RequestMessage) - itu digabung di sini apa adanya. Warga yang chat tanpa pernah
 * punya Request aktif dan sebelum fitur ini ada TIDAK bisa dimunculkan lagi - teksnya
 * memang tidak pernah tersimpan di mana pun.
 *
 * `channel` memisahkan percakapan lewat nomor layanan (SERVICE, ada alur Request/bot) dari
 * nomor kedua (SECONDARY, murni perangkat tertaut manual - tidak ada Request sama sekali,
 * jadi RequestMessage tidak pernah ikut digabung untuk channel ini). Grup WA (isGroup) cuma
 * pernah muncul di channel SECONDARY - handler nomor layanan sengaja tidak memproses grup.
 */
export async function getInboxConversations(channel: InboxChannel = "SERVICE"): Promise<InboxConversation[]> {
  const [recentInbox, requestsWithMessages] = await Promise.all([
    prisma.inboxMessage.findMany({ where: { channel }, orderBy: { createdAt: "desc" }, take: 1000 }),
    channel === "SERVICE"
      ? prisma.request.findMany({
          where: { messages: { some: {} } },
          select: {
            waJid: true,
            waNumber: true,
            messages: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        })
      : Promise.resolve([]),
  ]);

  const latestByWaJid = new Map<
    string,
    {
      waNumber: string;
      lastMessage: string;
      lastDirection: "INBOUND" | "OUTBOUND";
      lastAt: Date;
      isGroup: boolean;
      groupName: string | null;
      lastSenderName: string | null;
    }
  >();

  for (const m of recentInbox) {
    const existing = latestByWaJid.get(m.waJid);
    if (existing && existing.lastAt >= m.createdAt) continue;
    latestByWaJid.set(m.waJid, {
      waNumber: m.waNumber,
      lastMessage: m.message,
      lastDirection: m.direction,
      lastAt: m.createdAt,
      isGroup: m.isGroup,
      groupName: m.groupName,
      lastSenderName: m.senderName,
    });
  }

  for (const r of requestsWithMessages) {
    const last = r.messages[0];
    if (!last) continue;
    const existing = latestByWaJid.get(r.waJid);
    if (existing && existing.lastAt >= last.createdAt) continue;
    latestByWaJid.set(r.waJid, {
      waNumber: r.waNumber,
      lastMessage: last.message,
      lastDirection: last.direction,
      lastAt: last.createdAt,
      isGroup: false,
      groupName: null,
      lastSenderName: null,
    });
  }

  const conversations: InboxConversation[] = [...latestByWaJid.entries()]
    .map(([waJid, v]) => ({
      waJid,
      waNumber: v.waNumber,
      lastMessage: v.lastMessage,
      lastDirection: v.lastDirection,
      lastAt: v.lastAt.toISOString(),
      takeoverActive: false,
      isGroup: v.isGroup,
      groupName: v.groupName,
      lastSenderName: v.lastSenderName,
    }))
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

  // Konsep "ambil alih" cuma berlaku untuk nomor layanan (ada bot yang bisa dialihkan
  // dari mode otomatis) - nomor kedua tidak pernah punya balasan otomatis sama sekali,
  // jadi selalu bisa dibalas langsung tanpa toggle apa pun.
  if (channel !== "SERVICE") {
    return conversations.map((c) => ({ ...c, takeoverActive: true }));
  }

  const takeovers = await prisma.humanTakeover.findMany({
    where: { waJid: { in: conversations.map((c) => c.waJid) } },
    select: { waJid: true },
  });
  const takeoverSet = new Set(takeovers.map((t) => t.waJid));

  return conversations.map((c) => ({ ...c, takeoverActive: takeoverSet.has(c.waJid) }));
}
