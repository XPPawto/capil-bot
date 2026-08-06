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

export interface GroupMeta {
  isGroup: boolean;
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
  extraAccountId?: number
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
      groupName: group?.groupName,
      senderNumber: group?.senderNumber,
      senderName: group?.senderName,
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
  extraAccountId?: number
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
      groupName: group?.groupName,
      senderNumber: group?.senderNumber,
      senderName: group?.senderName,
    },
  });
}

/** Dicatat tiap ada panggilan suara/video masuk (yang otomatis ditolak - lihat callHandler.ts),
 * supaya kelihatan juga di Pesan Masuk sebagai bagian dari riwayat kontak orang itu dengan bot,
 * bukan cuma hilang begitu saja setelah ditolak. */
export async function logInboxCallEvent(waJid: string, waNumber: string, isVideo: boolean): Promise<void> {
  const label = isVideo ? "Panggilan video" : "Panggilan suara";
  await prisma.inboxMessage.create({
    data: { waJid, waNumber, direction: "INBOUND", message: `[${label} masuk - ditolak otomatis]` },
  });
}
