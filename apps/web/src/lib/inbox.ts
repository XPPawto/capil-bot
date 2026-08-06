import { prisma } from "@/lib/prisma";

export interface InboxConversation {
  waJid: string;
  waNumber: string;
  lastMessage: string;
  lastDirection: "INBOUND" | "OUTBOUND";
  lastAt: string;
  takeoverActive: boolean;
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
 */
export async function getInboxConversations(): Promise<InboxConversation[]> {
  const [recentInbox, requestsWithMessages] = await Promise.all([
    prisma.inboxMessage.findMany({ orderBy: { createdAt: "desc" }, take: 1000 }),
    prisma.request.findMany({
      where: { messages: { some: {} } },
      select: {
        waJid: true,
        waNumber: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
  ]);

  const latestByWaJid = new Map<
    string,
    { waNumber: string; lastMessage: string; lastDirection: "INBOUND" | "OUTBOUND"; lastAt: Date }
  >();

  for (const m of recentInbox) {
    const existing = latestByWaJid.get(m.waJid);
    if (existing && existing.lastAt >= m.createdAt) continue;
    latestByWaJid.set(m.waJid, {
      waNumber: m.waNumber,
      lastMessage: m.message,
      lastDirection: m.direction,
      lastAt: m.createdAt,
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
    }))
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

  const takeovers = await prisma.humanTakeover.findMany({
    where: { waJid: { in: conversations.map((c) => c.waJid) } },
    select: { waJid: true },
  });
  const takeoverSet = new Set(takeovers.map((t) => t.waJid));

  return conversations.map((c) => ({ ...c, takeoverActive: takeoverSet.has(c.waJid) }));
}
