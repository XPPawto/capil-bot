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
  isChannel: boolean;
  groupName: string | null;
  lastSenderName: string | null;
  /** Nama profil WA lawan bicara (bukan grup) - null kalau belum pernah terekam. */
  contactName: string | null;
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
 * akun ekstra (EXTRA, murni perangkat tertaut manual - tidak ada Request sama sekali, jadi
 * RequestMessage tidak pernah ikut digabung untuk channel ini). Kalau channel EXTRA, WAJIB
 * sertakan `extraAccountId` - bisa ada banyak akun ekstra sekaligus (Akun Kedua, Ketiga,
 * dst), masing-masing punya daftar percakapannya sendiri. Grup WA (isGroup) cuma pernah
 * muncul di channel EXTRA - handler nomor layanan sengaja tidak memproses grup.
 */
export async function getInboxConversations(
  channel: InboxChannel = "SERVICE",
  extraAccountId?: number
): Promise<InboxConversation[]> {
  const [recentInbox, requestsWithMessages] = await Promise.all([
    prisma.inboxMessage.findMany({
      where: channel === "EXTRA" ? { channel, extraAccountId } : { channel },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
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
      isChannel: boolean;
      groupName: string | null;
      lastSenderName: string | null;
    }
  >();

  // Nama kontak dilacak terpisah dari "pesan terakhir" - pesan terakhir bisa saja balasan
  // KITA (tidak punya senderName), padahal kita tetap ingin tahu nama profil WA lawan
  // bicaranya dari pesan MASUK mereka yang paling baru. recentInbox sudah terurut desc,
  // jadi kemunculan pertama per waJid otomatis yang paling baru.
  const contactNameByWaJid = new Map<string, string>();

  // Nomor HP yang DITAMPILKAN juga dilacak terpisah dari "pesan terakhir", dengan alasan
  // yang sama seperti nama kontak: kalau pesan terakhirnya balasan KITA yang diketik
  // langsung dari HP ke warga yang JID-nya di-mask WhatsApp ("@lid"), waNumber di baris
  // itu bisa jadi ID internal WhatsApp yang panjang & bukan nomor HP asli (celah yang sudah
  // diperbaiki di sisi bot untuk data baru, tapi baris lama yang terlanjur salah masih ada).
  // Pesan MASUK selalu benar (lewat senderPn) - diutamakan kalau ada, baru fallback ke pesan
  // terakhir apa pun kalau warga itu belum pernah membalas sama sekali.
  const bestWaNumberByWaJid = new Map<string, string>();

  for (const m of recentInbox) {
    if (!m.isGroup && !m.isChannel && m.direction === "INBOUND" && m.senderName && !contactNameByWaJid.has(m.waJid)) {
      contactNameByWaJid.set(m.waJid, m.senderName);
    }
    if (m.direction === "INBOUND" && !bestWaNumberByWaJid.has(m.waJid)) {
      bestWaNumberByWaJid.set(m.waJid, m.waNumber);
    }

    const existing = latestByWaJid.get(m.waJid);
    if (existing && existing.lastAt >= m.createdAt) continue;
    latestByWaJid.set(m.waJid, {
      waNumber: m.waNumber,
      lastMessage: m.message,
      lastDirection: m.direction,
      lastAt: m.createdAt,
      isGroup: m.isGroup,
      isChannel: m.isChannel,
      groupName: m.groupName,
      lastSenderName: m.senderName,
    });
  }

  for (const r of requestsWithMessages) {
    // Request.waNumber sendiri (bukan cuma pesannya) juga sumber yang bisa dipercaya -
    // diisi lewat alur intake bot yang resolusinya sudah benar sejak awal.
    if (!bestWaNumberByWaJid.has(r.waJid)) {
      bestWaNumberByWaJid.set(r.waJid, r.waNumber);
    }

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
      isChannel: false,
      groupName: null,
      lastSenderName: null,
    });
  }

  const conversations: InboxConversation[] = [...latestByWaJid.entries()]
    .map(([waJid, v]) => ({
      waJid,
      waNumber: bestWaNumberByWaJid.get(waJid) ?? v.waNumber,
      lastMessage: v.lastMessage,
      lastDirection: v.lastDirection,
      lastAt: v.lastAt.toISOString(),
      takeoverActive: false,
      isGroup: v.isGroup,
      isChannel: v.isChannel,
      groupName: v.groupName,
      lastSenderName: v.lastSenderName,
      contactName: contactNameByWaJid.get(waJid) ?? null,
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

/**
 * Jumlah percakapan yang pesan terakhirnya dari warga (belum dibalas) - dasar badge
 * notifikasi di tab akun (/admin-xpawto). Dipanggil terpisah per akun (bukan sekali untuk
 * semua) supaya badge tetap muncul untuk tab yang SEDANG TIDAK dibuka - kalau cuma
 * menghitung dari daftar percakapan tab aktif, tab lain tidak akan pernah dapat badge.
 */
export async function countNeedsReply(channel: InboxChannel, extraAccountId?: number): Promise<number> {
  const conversations = await getInboxConversations(channel, extraAccountId);
  return conversations.filter((c) => c.lastDirection === "INBOUND").length;
}
