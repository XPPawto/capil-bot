import { prisma, appendLedgerEntry, type InboxChannel, type InboxMessage } from "@kelurahan/db";
import { logger } from "../logger";

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
 * Setiap baris InboxMessage yang dibuat WAJIB lewat fungsi ini (bukan prisma.inboxMessage.create
 * langsung) - supaya tidak ada satu pun baris yang lolos tanpa jejak ledger (lihat
 * @kelurahan/db/auditLedger.ts). Kegagalan menulis ledger DICATAT SEBAGAI ERROR (bukan cuma
 * warning) supaya kelihatan jelas kalau perlu perhatian manual - tapi TIDAK membatalkan baris
 * InboxMessage yang sudah berhasil dibuat (mencatat chat warga selalu lebih prioritas daripada
 * fitur audit di atasnya).
 */
async function createLedgeredInboxMessage(data: Parameters<typeof prisma.inboxMessage.create>[0]["data"]): Promise<InboxMessage> {
  const row = await prisma.inboxMessage.create({ data });
  try {
    await appendLedgerEntry("MESSAGE_CREATED", row.id, {
      waJid: row.waJid,
      waNumber: row.waNumber,
      channel: row.channel,
      extraAccountId: row.extraAccountId,
      direction: row.direction,
      message: row.message,
      attachmentPath: row.attachmentPath,
      attachmentMimeType: row.attachmentMimeType,
      attachmentSha256: null,
      isGroup: row.isGroup,
      isChannel: row.isChannel,
      groupName: row.groupName,
      senderNumber: row.senderNumber,
      senderName: row.senderName,
      adminId: row.adminId,
      waMessageId: row.waMessageId,
      createdAt: row.createdAt.toISOString(),
      latitude: row.latitude,
      longitude: row.longitude,
    });
  } catch (err) {
    logger.error({ err, inboxMessageId: row.id }, "GAGAL menulis jejak audit ledger untuk pesan yang baru dicatat");
  }
  return row;
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

/** Koordinat share-lokasi/live-location, kalau pesannya memang lokasi - lihat
 * extractLocationCoords di messageHandler.ts. */
export interface LocationCoords {
  latitude: number;
  longitude: number;
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
  waMessageId?: string,
  coords?: LocationCoords
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  await createLedgeredInboxMessage({
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
    latitude: coords?.latitude,
    longitude: coords?.longitude,
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
  waMessageId?: string,
  coords?: LocationCoords
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  await createLedgeredInboxMessage({
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
    latitude: coords?.latitude,
    longitude: coords?.longitude,
  });
}

/**
 * Cari SEMUA baris InboxMessage yang waMessageId-nya PERSIS cocok - dipakai bersama oleh
 * applyMessageEdit/applyMessageDelete/updateMessageStatus. SENGAJA `findMany`, bukan
 * `findFirst`: satu waMessageId asli WhatsApp normalnya cuma cocok ke satu baris, TAPI kalau
 * pernah ada baris duplikat tercatat untuk pesan yang sama (bug logging terpisah, di luar
 * cakupan fungsi-fungsi ini), `findFirst` bisa memilih baris yang salah secara tidak
 * konsisten (urutan hasil query tanpa ORDER BY tidak dijamin stabil) - beberapa duplikat
 * jadi tidak pernah ikut ter-update walau event edit/hapus/status-nya sudah benar diproses.
 * Dengan menangani SEMUA baris yang cocok sekaligus, hasilnya konsisten apa pun urutan
 * baris di database, dan tetap sesuai batasan "HANYA baris pesan yang dimaksud" - duplikat
 * di sini tetap baris yang sama-sama mewakili SATU pesan WhatsApp asli yang sama persis.
 */
async function findMatchingInboxMessageIds(
  waJid: string,
  waMessageId: string,
  channel: InboxChannel,
  extraAccountId?: number
): Promise<number[]> {
  const rows = await prisma.inboxMessage.findMany({
    where: channel === "EXTRA" ? { waJid, waMessageId, channel, extraAccountId } : { waJid, waMessageId, channel },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Dipanggil kalau WhatsApp mengirim event edit pesan (protocolMessage tipe MESSAGE_EDIT) -
 * cari baris InboxMessage yang waMessageId-nya PERSIS cocok (satu pesan asli = satu ID unik
 * dari WhatsApp) lalu update isinya DI TEMPAT. HANYA baris (atau baris-baris, kalau ada
 * duplikat - lihat findMatchingInboxMessageIds) yang cocok itu yang tersentuh, dan kalau
 * tidak ketemu sama sekali (mis. pesan aslinya tidak pernah tercatat, atau dari sebelum
 * fitur ini ada), tidak melakukan apa-apa. Edit ini SENDIRI juga dicatat sebagai entri
 * ledger baru (MESSAGE_EDITED) per baris - jadi perubahan yang sah ini tetap kelihatan jelas
 * di riwayat audit, beda dari perubahan liar yang tidak lewat sini.
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
  const ids = await findMatchingInboxMessageIds(waJid, waMessageId, channel, extraAccountId);
  if (ids.length === 0) return false;

  const editedAt = new Date();
  for (const id of ids) {
    await prisma.inboxMessage.update({ where: { id }, data: { message: trimmed, editedAt } });
    try {
      await appendLedgerEntry("MESSAGE_EDITED", id, { newMessage: trimmed, editedAt: editedAt.toISOString() });
    } catch (err) {
      logger.error({ err, inboxMessageId: id }, "GAGAL menulis jejak audit ledger untuk edit pesan");
    }
  }
  return true;
}

/**
 * Dipanggil kalau WhatsApp mengirim event hapus pesan (protocolMessage tipe REVOKE, dikirim
 * saat siapa pun - warga atau kita sendiri - menghapus pesan yang sudah terkirim). Sama
 * seperti applyMessageEdit, dicari lewat waMessageId dan HANYA baris (atau baris-baris) yang
 * cocok itu yang tersentuh. Isi `message` SENGAJA TIDAK dihapus/ditimpa - baris cuma
 * ditandai `deletedAt`, supaya riwayat percakapan tetap utuh untuk keperluan audit (justru
 * inti dari ledger di atas). Penghapusan ini SENDIRI juga dicatat sebagai entri ledger baru
 * (MESSAGE_DELETED) per baris.
 */
export async function applyMessageDelete(
  waJid: string,
  waMessageId: string,
  channel: InboxChannel,
  extraAccountId?: number
): Promise<boolean> {
  const ids = await findMatchingInboxMessageIds(waJid, waMessageId, channel, extraAccountId);
  if (ids.length === 0) return false;

  const deletedAt = new Date();
  for (const id of ids) {
    await prisma.inboxMessage.update({ where: { id }, data: { deletedAt } });
    try {
      await appendLedgerEntry("MESSAGE_DELETED", id, { deletedAt: deletedAt.toISOString() });
    } catch (err) {
      logger.error({ err, inboxMessageId: id }, "GAGAL menulis jejak audit ledger untuk penghapusan pesan");
    }
  }
  return true;
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
  const existingRows = await prisma.inboxMessage.findMany({
    where:
      channel === "EXTRA"
        ? { waJid, waMessageId, channel, extraAccountId }
        : { waJid, waMessageId, channel },
    select: { id: true, status: true },
  });
  if (existingRows.length === 0) return false;

  // Sama seperti applyMessageEdit/applyMessageDelete - kalau ada baris duplikat untuk
  // waMessageId yang sama, SEMUA ikut diperbarui (bukan cuma satu yang dipilih findFirst
  // secara tidak konsisten), tiap baris tetap dicek "jangan mundur" milik dirinya sendiri.
  for (const existing of existingRows) {
    if (existing.status && STATUS_RANK[existing.status] >= STATUS_RANK[status]) continue;
    await prisma.inboxMessage.update({ where: { id: existing.id }, data: { status } });
    try {
      await appendLedgerEntry("STATUS_CHANGED", existing.id, { newStatus: status });
    } catch (err) {
      logger.error({ err, inboxMessageId: existing.id }, "GAGAL menulis jejak audit ledger untuk perubahan status pesan");
    }
  }
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
  await createLedgeredInboxMessage({
    waJid,
    waNumber,
    channel,
    extraAccountId,
    direction: "INBOUND",
    message: `[${label} masuk - ${outcome}]`,
  });
}
