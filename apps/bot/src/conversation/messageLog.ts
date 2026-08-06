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
 * membedakan nomor layanan (SERVICE, default) dari nomor kedua yang bukan bot (SECONDARY).
 * `group` diisi cuma untuk pesan grup (lihat secondaryMessageHandler.ts) - waJid tetap JID
 * grupnya, sementara senderNumber/senderName mencatat siapa yang benar-benar mengirim.
 */
export async function logInboxMessage(
  waJid: string,
  waNumber: string,
  text: string,
  channel: InboxChannel = "SERVICE",
  group?: GroupMeta
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  await prisma.inboxMessage.create({
    data: {
      waJid,
      waNumber,
      channel,
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
 * Dicatat saat pengirim membalas LANGSUNG dari HP nomor kedua (bukan lewat dashboard
 * /admin-xpawto) - WhatsApp multi-device tetap mengirim event pesan itu ke kita sebagai
 * perangkat tertaut (lihat sentMessageTracker.ts untuk cara membedakannya dari echo
 * balasan dashboard). adminId sengaja tidak diisi (bukan berasal dari sesi admin manapun)
 * - ditampilkan di UI dengan label berbeda supaya jelas ini balasan dari HP asli.
 */
export async function logOutboundFromDevice(
  waJid: string,
  waNumber: string,
  text: string,
  channel: InboxChannel = "SECONDARY",
  group?: GroupMeta
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  await prisma.inboxMessage.create({
    data: {
      waJid,
      waNumber,
      channel,
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
