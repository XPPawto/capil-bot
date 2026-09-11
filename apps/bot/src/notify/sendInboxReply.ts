import type { InboxChannel } from "@kelurahan/db";
import type { WAMessage } from "@whiskeysockets/baileys";
import { logger } from "../logger";
import { getSocket } from "../wa/socket";
import { getExtraAccountSocket } from "../wa/extraAccountManager";
import { humanSendMessage } from "../wa/humanSend";
import { notifyTelegramChatEvent } from "./telegramNotify";

export interface QuotedReplyInfo {
  waMessageId: string;
  fromMe: boolean;
  text: string;
}

/**
 * Baileys minta objek WAMessage (key + message) buat merangkai kutipan "reply" di WA
 * asli - kita cuma pegang waMessageId/teks/arah dari InboxMessage yang tersimpan di DB
 * (bukan WAMessage utuh, itu cuma ada di memori proses ini selagi live). Stub minimal ini
 * cukup untuk Baileys membangun contextInfo.quotedMessage yang benar (WA cuma butuh
 * key+teksnya buat menampilkan potongan kutipan, bukan seluruh struktur pesan asli).
 */
function buildQuotedStub(waJid: string, quoted: QuotedReplyInfo): WAMessage {
  return {
    key: { remoteJid: waJid, id: quoted.waMessageId, fromMe: quoted.fromMe },
    message: { conversation: quoted.text },
  } as WAMessage;
}

/**
 * Balasan bebas dari petugas lewat halaman "Pesan Masuk" - beda dari sendCustomMessage
 * (yang terikat pada satu Request) karena di sini cuma butuh waJid mentah, warga yang
 * membalas bisa jadi belum pernah punya pengajuan sama sekali. `channel` menentukan socket
 * mana yang dipakai mengirim - nomor layanan (SERVICE) atau salah satu akun ekstra (EXTRA,
 * butuh `extraAccountId` untuk tahu akun yang mana).
 */
export async function sendInboxReply(
  waJid: string,
  message: string,
  channel: InboxChannel = "SERVICE",
  extraAccountId?: number,
  quoted?: QuotedReplyInfo
): Promise<string | undefined> {
  const sock = channel === "EXTRA" && extraAccountId ? getExtraAccountSocket(extraAccountId) : getSocket();
  if (!sock) {
    throw new Error("Nomor WA belum terhubung, tidak bisa mengirim pesan.");
  }
  // ID pesan ini sudah otomatis ditandai di sentMessageTracker oleh humanSendMessage
  // sendiri (sebelum dikirim) - lihat wa/humanSend.ts - supaya echo "fromMe"-nya tidak
  // ikut dicatat dobel oleh messageHandler/extraAccountMessageHandler.
  const sent = await humanSendMessage(
    sock,
    waJid,
    { text: message },
    quoted ? buildQuotedStub(waJid, quoted) : undefined
  );
  logger.info({ waJid, channel, extraAccountId }, "Balasan kotak masuk terkirim ke warga");

  // Notifikasi Telegram (permintaan pemilik) - balasan dashboard TIDAK PERNAH lewat alur
  // messages.upsert biasa di extraAccountMessageHandler.ts (id-nya sudah ditandai
  // sentMessageTracker di atas, jadi handler itu selalu "continue" lebih awal) - makanya
  // dinotifikasi langsung di sini, satu-satunya tempat yang tahu ini balasan dashboard.
  if (channel === "EXTRA" && extraAccountId) {
    notifyTelegramChatEvent(extraAccountId, {
      kind: "outbound_dashboard",
      waNumber: waJid.split("@")[0],
      text: message,
    }).catch((err) => logger.warn({ err, waJid, extraAccountId }, "Gagal mengirim notifikasi Telegram"));
  }

  // Dikembalikan ke pemanggil (lewat control server -> web) supaya baris InboxMessage yang
  // dibuat di sisi web bisa menyimpan ID pesan ini - dipakai messages.update nanti untuk
  // memperbarui status centang (terkirim/sampai/dibaca) pesan yang SPESIFIK ini.
  return sent?.key?.id ?? undefined;
}
