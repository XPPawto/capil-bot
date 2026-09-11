import { prisma } from "@/lib/prisma";
import { Prisma, type InboxChannel } from "@prisma/client";

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
  pinned: boolean;
  archived: boolean;
  /** Ditandai manual lewat menu klik-kanan ("Tandai belum dibaca") - lihat
   * InboxConversationState.manualUnreadAt di schema.prisma. Independen dari badge "belum
   * dibalas" bawaan (lastDirection === INBOUND). */
  manualUnread: boolean;
}

/** InboxConversationState.extraAccountId pakai sentinel 0 buat SERVICE (lihat komentar
 * model di schema.prisma - unique index gabungan MySQL tidak menganggap NULL=NULL). */
function conversationStateAccountId(channel: InboxChannel, extraAccountId?: number): number {
  return channel === "EXTRA" ? (extraAccountId ?? 0) : 0;
}

/** Satu-satunya jalur tulis ke InboxConversationState - dipakai rute pin/arsip/tandai
 * belum-dibaca. Upsert supaya percakapan yang belum pernah disentuh (belum ada barisnya
 * sama sekali) tetap bisa langsung di-pin/diarsipkan pertama kali. */
export async function upsertConversationState(
  waJid: string,
  channel: InboxChannel,
  extraAccountId: number | undefined,
  patch: { pinnedAt?: Date | null; archivedAt?: Date | null; manualUnreadAt?: Date | null }
): Promise<void> {
  const accountId = conversationStateAccountId(channel, extraAccountId);
  await prisma.inboxConversationState.upsert({
    where: { waJid_channel_extraAccountId: { waJid, channel, extraAccountId: accountId } },
    create: { waJid, channel, extraAccountId: accountId, ...patch },
    update: patch,
  });
}

// Baris hasil kueri "satu pesan terakhir per percakapan" - lihat catatan performa di
// getInboxConversations. isGroup/isChannel datang sebagai 0/1 (tinyint) dari raw query.
interface LatestRow {
  waJid: string;
  waNumber: string;
  message: string;
  direction: "INBOUND" | "OUTBOUND";
  createdAt: Date;
  isGroup: number | boolean;
  isChannel: number | boolean;
  groupName: string | null;
  senderName: string | null;
}

interface LatestInboundRow {
  waJid: string;
  waNumber: string;
  senderName: string | null;
  isGroup: number | boolean;
  isChannel: number | boolean;
}

function accountFilter(channel: InboxChannel, extraAccountId?: number) {
  return channel === "EXTRA" && extraAccountId != null
    ? Prisma.sql`AND extraAccountId = ${extraAccountId}`
    : Prisma.empty;
}

/**
 * Kotak masuk cuma mulai mencatat SEMUA pesan mentah (InboxMessage) sejak fitur ini
 * di-deploy - WhatsApp/Baileys tidak punya cara menarik ulang histori chat lama secara
 * andal (history sync bawaan Baileys cuma jalan sekali saat perangkat BARU ditautkan lewat
 * QR, sengaja dimatikan di proyek ini karena berat & tidak reliabel).
 *
 * Untuk histori SEBELUM fitur ini ada, satu-satunya teks asli yang pernah benar-benar
 * tersimpan adalah percakapan bebas selagi seseorang punya Request aktif (tabel
 * RequestMessage) - digabung di sini untuk channel SERVICE.
 *
 * PERFORMA (ini yang membuat akun ramai dulu lambat sekali dibuka): dulu "satu baris terakhir
 * per percakapan" diambil lewat `prisma.inboxMessage.findMany({ distinct: ["waJid"] })`. Untuk
 * MySQL, Prisma TIDAK menerjemahkan `distinct` ke SQL - ia MENGAMBIL SEMUA baris yang cocok ke
 * memori Node lalu men-dedupe di sana. Akun dengan ribuan pesan berarti ribuan baris ditarik
 * TIAP poll (daftar tiap 6 dtk + badge belum-dibalas per akun). Diganti kueri GROUP BY yang
 * cuma mengambil TEPAT satu baris terakhir per percakapan (lewat MAX(id), didukung index
 * komposit di schema.prisma) - beban jadi ~jumlah percakapan, bukan ~jumlah total pesan.
 */
export async function getInboxConversations(
  channel: InboxChannel = "SERVICE",
  extraAccountId?: number,
  opts?: { archived?: boolean }
): Promise<InboxConversation[]> {
  const filter = accountFilter(channel, extraAccountId);
  const showArchived = opts?.archived ?? false;

  const [latestPerWaJid, latestInboundPerWaJid, requestsWithMessages, states] = await Promise.all([
    prisma.$queryRaw<LatestRow[]>(Prisma.sql`
      SELECT m.waJid AS waJid, m.waNumber AS waNumber, m.message AS message, m.direction AS direction,
             m.createdAt AS createdAt, m.isGroup AS isGroup, m.isChannel AS isChannel,
             m.groupName AS groupName, m.senderName AS senderName
      FROM InboxMessage m
      JOIN (
        SELECT MAX(id) AS maxId FROM InboxMessage
        WHERE channel = ${channel} ${filter}
        GROUP BY waJid
      ) g ON g.maxId = m.id
    `),
    // Kueri terpisah, khusus pesan MASUK - dipakai untuk nama kontak & nomor HP yang
    // ditampilkan, yang harus berasal dari pesan masuk PALING BARU (bukan balasan kita sendiri,
    // yang JID-nya bisa di-mask "@lid" dengan nomor keliru).
    prisma.$queryRaw<LatestInboundRow[]>(Prisma.sql`
      SELECT m.waJid AS waJid, m.waNumber AS waNumber, m.senderName AS senderName,
             m.isGroup AS isGroup, m.isChannel AS isChannel
      FROM InboxMessage m
      JOIN (
        SELECT MAX(id) AS maxId FROM InboxMessage
        WHERE channel = ${channel} ${filter} AND direction = 'INBOUND'
        GROUP BY waJid
      ) g ON g.maxId = m.id
    `),
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
    prisma.inboxConversationState.findMany({
      where: { channel, extraAccountId: conversationStateAccountId(channel, extraAccountId) },
    }),
  ]);

  const stateByWaJid = new Map(states.map((s) => [s.waJid, s]));

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

  // Nama kontak & nomor HP yang DITAMPILKAN dilacak terpisah dari "pesan terakhir" - keduanya
  // WAJIB dari pesan MASUK warga paling baru (lihat komentar di atas).
  const contactNameByWaJid = new Map<string, string>();
  const bestWaNumberByWaJid = new Map<string, string>();
  for (const m of latestInboundPerWaJid) {
    if (!m.isGroup && !m.isChannel && m.senderName) contactNameByWaJid.set(m.waJid, m.senderName);
    bestWaNumberByWaJid.set(m.waJid, m.waNumber);
  }

  for (const m of latestPerWaJid) {
    latestByWaJid.set(m.waJid, {
      waNumber: m.waNumber,
      lastMessage: m.message,
      lastDirection: m.direction,
      lastAt: new Date(m.createdAt),
      isGroup: Boolean(m.isGroup),
      isChannel: Boolean(m.isChannel),
      groupName: m.groupName,
      lastSenderName: m.senderName,
    });
  }

  for (const r of requestsWithMessages) {
    // Request.waNumber sendiri juga sumber tepercaya (diisi lewat intake bot yang resolusinya benar).
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
    .map(([waJid, v]) => {
      const state = stateByWaJid.get(waJid);
      return {
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
        pinned: Boolean(state?.pinnedAt),
        archived: Boolean(state?.archivedAt),
        manualUnread: Boolean(state?.manualUnreadAt),
      };
    })
    // Diarsipkan disembunyikan dari daftar utama (dan sebaliknya) - persis WA, dua daftar
    // terpisah bukan satu daftar campur dengan penanda visual saja.
    .filter((c) => c.archived === showArchived)
    // Dipin naik ke atas dulu (di antara sesama yang dipin tetap urut pesan terbaru), baru
    // sisanya urut waktu seperti biasa - bukan diurutkan berdasar KAPAN di-pin (WA Web
    // sendiri juga begitu: pin cuma menaikkan grup, bukan alat urut sendiri).
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
    });

  // "Ambil alih" cuma berlaku untuk nomor layanan (ada bot yang bisa dialihkan dari mode
  // otomatis) - akun ekstra tidak pernah punya balasan otomatis, jadi selalu bisa dibalas.
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
 * Jumlah percakapan yang pesan terakhirnya dari warga (belum dibalas) - dasar badge notifikasi
 * di tab akun. Dipanggil terpisah per akun pada TIAP poll unread-counts, jadi harus murah.
 *
 * Untuk EXTRA (di mana bisa ada banyak akun ramai sekaligus - sumber utama masalah performa)
 * dipakai satu kueri agregat langsung, bukan membangun ulang seluruh daftar percakapan. Untuk
 * SERVICE (akun tunggal, plus perlu ikut memperhitungkan RequestMessage lama) tetap lewat
 * getInboxConversations supaya semantiknya persis sama seperti sebelumnya.
 */
export async function countNeedsReply(channel: InboxChannel, extraAccountId?: number): Promise<number> {
  if (channel === "SERVICE") {
    const conversations = await getInboxConversations(channel, extraAccountId);
    return conversations.filter((c) => c.lastDirection === "INBOUND").length;
  }

  const rows = await prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`
    SELECT COUNT(*) AS c
    FROM InboxMessage m
    JOIN (
      SELECT MAX(id) AS maxId FROM InboxMessage
      WHERE channel = ${channel} ${accountFilter(channel, extraAccountId)}
      GROUP BY waJid
    ) g ON g.maxId = m.id
    WHERE m.direction = 'INBOUND'
  `);
  return Number(rows[0]?.c ?? 0);
}
