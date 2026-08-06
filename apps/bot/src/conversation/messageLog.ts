import { prisma, type InboxChannel } from "@kelurahan/db";

/**
 * Dipanggil saat warga chat bebas di luar alur formulir (bot tidak mengenali sebagai
 * command/pilihan layanan). Kalau warga punya pengajuan aktif, catat pesannya supaya
 * petugas bisa lihat di dashboard sebagai konteks percakapan - mis. warga tanya
 * "kapan selesai ya?" saat pengajuannya masih DICEK/DIPROSES.
 */
export async function logInboundIfActiveRequest(waJid: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const active = await prisma.request.findFirst({
    where: { waJid, status: { in: ["DICEK", "DIPROSES"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!active) return;

  await prisma.requestMessage.create({
    data: { requestId: active.id, direction: "INBOUND", message: trimmed },
  });
}

/**
 * Cari nomor HP asli yang SUDAH PERNAH tercatat benar untuk waJid ini, dari pesan MASUK
 * (yang selalu diresolusi lewat senderPn - lihat extractWaNumber di messageHandler.ts,
 * jadi selalu bisa dipercaya), atau dari Request kalau ada. Dipakai KHUSUS untuk kasus
 * fromMe/balasan-dari-HP (lihat messageHandler.ts & extraAccountMessageHandler.ts): kalau
 * remoteJid warga itu ternyata di-mask WhatsApp sebagai "@lid" (fitur privasi), sekadar
 * ambil `jid.split("@")[0]` menghasilkan ID internal WhatsApp yang panjang & tidak masuk
 * akal (bukan nomor HP sungguhan) - dengan mengutamakan nomor yang sudah pernah terbukti
 * benar dari histori, tampilan di /admin-xpawto tetap nomor HP yang wajar untuk percakapan
 * yang sudah ada, meskipun JID mentahnya di-mask.
 */
export async function resolveKnownWaNumber(waJid: string): Promise<string | null> {
  const inbound = await prisma.inboxMessage.findFirst({
    where: { waJid, direction: "INBOUND" },
    orderBy: { createdAt: "desc" },
    select: { waNumber: true },
  });
  if (inbound) return inbound.waNumber;

  const req = await prisma.request.findFirst({
    where: { waJid },
    orderBy: { createdAt: "desc" },
    select: { waNumber: true },
  });
  return req?.waNumber ?? null;
}

export interface GroupMeta {
  isGroup: boolean;
  isChannel?: boolean;
  groupName?: string;
  senderNumber?: string;
  senderName?: string;
}

/**
 * Dipanggil untuk SETIAP pesan teks masuk, terlepas dia punya Request aktif atau tidak -
 * dasar dari halaman "Pesan Masuk" di dashboard, supaya petugas bisa lihat siapa saja yang
 * chat bot (termasuk yang sekadar tanya-tanya, belum pernah mengajukan apa pun). `channel`
 * membedakan nomor layanan (SERVICE, default) dari akun ekstra yang bukan bot (EXTRA) -
 * kalau EXTRA, `extraAccountId` WAJIB diisi supaya tahu akun ekstra mana yang menerimanya
 * (bisa lebih dari satu, lihat extraAccountMessageHandler.ts). `group` diisi cuma untuk
 * pesan grup - waJid tetap JID grupnya, senderNumber/senderName mencatat pengirim asli.
 */
export async function logInboxMessage(
  waJid: string,
  waNumber: string,
  text: string,
  channel: InboxChannel = "SERVICE",
  group?: GroupMeta,
  extraAccountId?: number,
  waMessageId?: string
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  await prisma.inboxMessage.create({
    data: {
      waJid,
      waNumber,
      channel,
      extraAccountId,
      direction: "INBOUND",
      message: trimmed,
      isGroup: group?.isGroup ?? false,
      isChannel: group?.isChannel ?? false,
      groupName: group?.groupName,
      senderNumber: group?.senderNumber,
      senderName: group?.senderName,
      waMessageId,
    },
  });
}

/**
 * Dicatat saat pengirim membalas LANGSUNG dari HP akun ekstra (bukan lewat dashboard
 * /admin-xpawto) - WhatsApp multi-device tetap mengirim event pesan itu ke kita sebagai
 * perangkat tertaut (lihat sentMessageTracker.ts untuk cara membedakannya dari echo
 * balasan dashboard). adminId sengaja tidak diisi (bukan berasal dari sesi admin manapun)
 * - ditampilkan di UI dengan label berbeda supaya jelas ini balasan dari HP asli.
 */
export async function logOutboundFromDevice(
  waJid: string,
  waNumber: string,
  text: string,
  channel: InboxChannel = "EXTRA",
  group?: GroupMeta,
  extraAccountId?: number,
  waMessageId?: string
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  await prisma.inboxMessage.create({
    data: {
      waJid,
      waNumber,
      channel,
      extraAccountId,
      direction: "OUTBOUND",
      message: trimmed,
      isGroup: group?.isGroup ?? false,
      isChannel: group?.isChannel ?? false,
      groupName: group?.groupName,
      senderNumber: group?.senderNumber,
      senderName: group?.senderName,
      waMessageId,
    },
  });
}

/**
 * Dipanggil kalau WhatsApp mengirim event edit pesan (protocolMessage tipe MESSAGE_EDIT) -
 * cari baris InboxMessage yang waMessageId-nya PERSIS cocok (satu pesan asli = satu ID unik
 * dari WhatsApp) lalu update isinya DI TEMPAT. HANYA baris itu yang tersentuh - tidak ada
 * baris lain yang ikut berubah, dan kalau baris yang dicari tidak ketemu (mis. pesan aslinya
 * tidak pernah tercatat, atau dari sebelum fitur ini ada), tidak melakukan apa-apa.
 */
export async function applyMessageEdit(
  waJid: string,
  waMessageId: string,
  newText: string,
  channel: InboxChannel,
  extraAccountId?: number
): Promise<boolean> {
  const trimmed = newText.trim();
  if (!trimmed) return false;
  const result = await prisma.inboxMessage.updateMany({
    where: channel === "EXTRA" ? { waJid, waMessageId, channel, extraAccountId } : { waJid, waMessageId, channel },
    data: { message: trimmed, editedAt: new Date() },
  });
  return result.count > 0;
}

/**
 * Dipanggil saat WhatsApp mengabari perubahan status centang pesan KELUAR (messages.update,
 * lihat messageHandler.ts) - "SENT" (satu centang, sudah sampai server WA), "DELIVERED" (dua
 * centang abu-abu, sudah sampai HP lawan bicara), "READ" (dua centang biru, sudah dibaca/
 * diputar). Sama seperti applyMessageEdit, dicari lewat waMessageId dan HANYA baris itu yang
 * tersentuh. WhatsApp bisa mengirim status yang "mundur" secara urutan waktu (mis. DELIVERED
 * datang belakangan setelah READ karena race di sisi WhatsApp sendiri) - status tidak pernah
 * benar-benar mundur di UI WA asli, jadi di sini juga cuma ditulis kalau bukan kemunduran dari
 * status yang sudah tercatat (rankStatus di bawah).
 */
const STATUS_RANK: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3 };

export async function updateMessageStatus(
  waJid: string,
  waMessageId: string,
  status: "SENT" | "DELIVERED" | "READ",
  channel: InboxChannel,
  extraAccountId?: number
): Promise<boolean> {
  const existing = await prisma.inboxMessage.findFirst({
    where:
      channel === "EXTRA"
        ? { waJid, waMessageId, channel, extraAccountId }
        : { waJid, waMessageId, channel },
    select: { id: true, status: true },
  });
  if (!existing) return false;
  if (existing.status && STATUS_RANK[existing.status] >= STATUS_RANK[status]) return true;

  await prisma.inboxMessage.update({ where: { id: existing.id }, data: { status } });
  return true;
}

/**
 * Dicatat tiap ada panggilan suara/video masuk, supaya kelihatan di Pesan Masuk sebagai
 * bagian dari riwayat kontak orang itu, bukan cuma hilang begitu saja. Nomor layanan
 * (SERVICE) selalu menolak otomatis - lihat callHandler.ts, outcome-nya selalu "ditolak
 * otomatis". Akun ekstra (EXTRA) TIDAK auto-reject (panggilan berdering normal di HP-nya,
 * bisa benar-benar diangkat manusia) - lihat extraAccountCallHandler.ts, outcome-nya bisa
 * "diangkat"/"ditolak"/"tidak dijawab" sesuai apa yang sungguh terjadi.
 */
export async function logInboxCallEvent(
  waJid: string,
  waNumber: string,
  isVideo: boolean,
  outcome: string,
  channel: InboxChannel = "SERVICE",
  extraAccountId?: number
): Promise<void> {
  const label = isVideo ? "Panggilan video" : "Panggilan suara";
  await prisma.inboxMessage.create({
    data: { waJid, waNumber, channel, extraAccountId, direction: "INBOUND", message: `[${label} masuk - ${outcome}]` },
  });
}
