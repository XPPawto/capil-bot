import type { InboxChannel } from "@kelurahan/db";
import { detectRealMimeType } from "../media/fileSignature";
import { logger } from "../logger";
import { getSocket } from "../wa/socket";
import { getExtraAccountSocket } from "../wa/extraAccountManager";
import { humanSendMessage } from "../wa/humanSend";

/**
 * Petugas kirim file (foto/dokumen) ke warga langsung dari halaman Pesan Masuk, tidak
 * terikat pada Request tertentu (beda dari sendFileToResident yang khusus dokumen hasil
 * pengajuan) - dipakai untuk kasus umum, mis. kirim contoh formulir atau info tambahan ke
 * warga yang sekadar bertanya. Sama seperti pengiriman file lain di proyek ini, mimetype
 * diverifikasi dari isi file asli (magic bytes), bukan cuma dipercaya dari klaim browser.
 * `channel` menentukan socket mana yang dipakai - nomor layanan atau salah satu akun ekstra.
 */
export async function sendInboxFile(
  waJid: string,
  fileName: string,
  claimedMimeType: string,
  fileBase64: string,
  channel: InboxChannel = "SERVICE",
  extraAccountId?: number
): Promise<void> {
  const sock = channel === "EXTRA" && extraAccountId ? getExtraAccountSocket(extraAccountId) : getSocket();
  if (!sock) {
    throw new Error("Nomor WA belum terhubung, tidak bisa mengirim file.");
  }

  const buffer = Buffer.from(fileBase64, "base64");
  const realMimeType = detectRealMimeType(buffer) ?? claimedMimeType;

  // ID pesan ini sudah otomatis ditandai di sentMessageTracker oleh humanSendMessage
  // sendiri sebelum dikirim - lihat wa/humanSend.ts.
  if (realMimeType.startsWith("image/")) {
    await humanSendMessage(sock, waJid, { image: buffer });
  } else {
    await humanSendMessage(sock, waJid, { document: buffer, fileName, mimetype: realMimeType });
  }

  logger.info({ waJid, fileName, realMimeType }, "File terkirim ke warga lewat Pesan Masuk");
}
