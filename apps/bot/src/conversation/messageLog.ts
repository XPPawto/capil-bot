import { prisma, appendLedgerEntry, type InboxChannel, type InboxMessage } from "@kelurahan/db";
import { logger } from "../logger";
import type { QuotedInfo } from "./messageHandler";

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
      isForwarded: row.isForwarded,
      quotedWaMessageId: row.quotedWaMessageId,
      quotedPreview: row.quotedPreview,
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
 * extractLocationCoords di messageHandler.ts. `isLive` membedakan share SEKALI KIRIM
 * (locationMessage) dari LIVE LOCATION (liveLocationMessage, bisa berturut-turut mengirim
 * update posisi baru selama share berlangsung) - dipakai logInboxMessage/logOutboundFromDevice
 * untuk memilih jalur "update baris yang sudah ada" (lihat applyLiveLocationUpdate) alih-alih
 * selalu bikin baris baru. */
export interface LocationCoords {
  latitude: number;
  longitude: number;
  isLive: boolean;
}

// Live location WhatsApp maksimal berlangsung 8 jam (pilihan durasi resmi: 15 menit/1 jam/8
// jam) - dipakai sebagai jendela waktu "masih mungkin sedang berlangsung" saat mencari baris
// live location TERAKHIR untuk waJid ini yang layak menerima update posisi baru, supaya share
// lama yang sudah pasti berakhir tidak keliru dianggap masih aktif.
const LIVE_LOCATION_WINDOW_MS = 8 * 60 * 60 * 1000;

/**
 * WhatsApp mengirim TIAP pembaruan posisi live location sebagai pesan BARU terpisah (masing-
 * masing ID pesan sendiri, ada `sequenceNumber` yang naik) - bukan lewat mekanisme "edit"
 * seperti protocolMessage. Tanpa penanganan khusus, tiap update akan tercatat sebagai baris
 * baru sendiri-sendiri, bikin thread penuh pesan "Live Location" berturut-turut selama
 * pengirimnya bergerak. Fungsi ini mencari baris live location TERAKHIR dari waJid+arah yang
 * sama dalam jendela waktu wajar (LIVE_LOCATION_WINDOW_MS) dan meng-update posisinya DI
 * TEMPAT kalau ketemu - satu bubble yang posisinya berubah, mirip tampilan WA asli. Kalau
 * tidak ketemu (share baru, atau share lama sudah lewat jendela waktu), kembalikan false
 * supaya pemanggil tahu harus bikin baris baru seperti biasa (share live location pertama
 * kali). Update ini SENDIRI juga dicatat sebagai entri ledger baru (LIVE_LOCATION_UPDATED).
 */
export async function applyLiveLocationUpdate(
  waJid: string,
  direction: "INBOUND" | "OUTBOUND",
  channel: InboxChannel,
  newText: string,
  coords: LocationCoords,
  extraAccountId?: number
): Promise<boolean> {
  const since = new Date(Date.now() - LIVE_LOCATION_WINDOW_MS);
  const existing = await prisma.inboxMessage.findFirst({
    where: {
      waJid,
      direction,
      channel,
      ...(channel === "EXTRA" ? { extraAccountId } : {}),
      message: { startsWith: "[Live Location]" },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!existing) return false;

  await prisma.inboxMessage.update({
    where: { id: existing.id },
    data: { message: newText, latitude: coords.latitude, longitude: coords.longitude },
  });
  try {
    await appendLedgerEntry("LIVE_LOCATION_UPDATED", existing.id, {
      newMessage: newText,
      latitude: coords.latitude,
      longitude: coords.longitude,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err, inboxMessageId: existing.id }, "GAGAL menulis jejak audit ledger untuk update live location");
  }
  return true;
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
  coords?: LocationCoords,
  isForwarded?: boolean,
  quoted?: QuotedInfo
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  if (coords?.isLive) {
    const merged = await applyLiveLocationUpdate(waJid, "INBOUND", channel, trimmed, coords, extraAccountId);
    if (merged) return;
  }

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
    isForwarded: isForwarded ?? false,
    quotedWaMessageId: quoted?.waMessageId,
    quotedPreview: quoted?.preview,
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
  coords?: LocationCoords,
  isForwarded?: boolean,
  quoted?: QuotedInfo
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  if (coords?.isLive) {
    const merged = await applyLiveLocationUpdate(waJid, "OUTBOUND", channel, trimmed, coords, extraAccountId);
    if (merged) return;
  }

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
    isForwarded: isForwarded ?? false,
    quotedWaMessageId: quoted?.waMessageId,
    quotedPreview: quoted?.preview,
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
 * Dipanggil kalau WhatsApp mengirim reactionMessage (reaksi emoji ke pesan yang sudah
 * terkirim - beda dari edit/hapus, ini BUKAN protocolMessage, jalur deteksinya sendiri di
 * messageHandler.ts). `emoji` kosong berarti pereaksi itu MEMBATALKAN reaksinya - baris
 * MessageReaction tetap disimpan (bukan dihapus), cuma emoji-nya jadi "" (lihat komentar
 * model di schema.prisma), supaya jejaknya tetap ada di ledger. Satu baris per (pesan,
 * pereaksi) - upsert di tempat, bukan baris baru tiap kali orang yang sama ganti reaksi.
 */
export async function applyMessageReaction(
  waJid: string,
  waMessageId: string,
  channel: InboxChannel,
  reactorJid: string,
  reactorName: string | undefined,
  emoji: string,
  extraAccountId?: number
): Promise<boolean> {
  const ids = await findMatchingInboxMessageIds(waJid, waMessageId, channel, extraAccountId);
  if (ids.length === 0) return false;

  const updatedAt = new Date();
  for (const id of ids) {
    await prisma.messageReaction.upsert({
      where: { inboxMessageId_reactorJid: { inboxMessageId: id, reactorJid } },
      create: { inboxMessageId: id, reactorJid, reactorName, emoji, updatedAt },
      update: { emoji, reactorName, updatedAt },
    });
    try {
      await appendLedgerEntry("REACTION_CHANGED", id, {
        reactorJid,
        reactorName: reactorName ?? null,
        emoji,
        updatedAt: updatedAt.toISOString(),
      });
    } catch (err) {
      logger.error({ err, inboxMessageId: id }, "GAGAL menulis jejak audit ledger untuk reaksi pesan");
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
  extraAccountId?: number,
  group?: { isGroup: boolean; groupName: string }
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

  // Baris TERPISAH di CallLog (bukan cuma InboxMessage di atas) supaya tab "Riwayat
  // Panggilan" di /admin-xpawto bisa query langsung ke tabel terstruktur, bukan menyaring
  // teks InboxMessage dengan awalan string. Best-effort murni - gagal di sini tidak boleh
  // menggagalkan pencatatan InboxMessage di atas (yang sudah berhasil tersimpan).
  try {
    await prisma.callLog.create({
      data: {
        waJid,
        waNumber,
        channel,
        extraAccountId,
        isVideo,
        isGroup: group?.isGroup ?? false,
        groupName: group?.groupName,
        outcome,
      },
    });
  } catch (err) {
    logger.error({ err, waJid, channel, extraAccountId }, "Gagal mencatat baris CallLog untuk panggilan");
  }
}
