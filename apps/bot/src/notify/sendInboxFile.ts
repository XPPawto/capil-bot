import type { InboxChannel } from "@kelurahan/db";
import { detectRealMimeType } from "../media/fileSignature";
import { transcodeToOggOpus } from "../media/transcodeAudio";
import { logger } from "../logger";
import { getSocket } from "../wa/socket";
import { getExtraAccountSocket } from "../wa/extraAccountManager";
import { humanSendMessage } from "../wa/humanSend";
import { sendTelegramMediaBuffer } from "./telegramNotify";

/**
 * Petugas kirim file (foto/video/voice note/dokumen) ke warga langsung dari halaman Pesan
 * Masuk, tidak terikat pada Request tertentu (beda dari sendFileToResident yang khusus
 * dokumen hasil pengajuan) - dipakai untuk kasus umum, mis. kirim contoh formulir, foto
 * lokasi, atau rekaman suara penjelasan ke warga yang sekadar bertanya. Sama seperti
 * pengiriman file lain di proyek ini, mimetype gambar diverifikasi dari isi file asli
 * (magic bytes) - video/audio dipercaya dari mimetype yang diklaim browser (bukan tipe
 * syarat yang divalidasi ketat, cuma untuk visibilitas/komunikasi). `channel` menentukan
 * socket mana yang dipakai - nomor layanan atau salah satu akun ekstra.
 */
export async function sendInboxFile(
  waJid: string,
  fileName: string,
  claimedMimeType: string,
  fileBase64: string,
  channel: InboxChannel = "SERVICE",
  extraAccountId?: number
): Promise<string | undefined> {
  const sock = channel === "EXTRA" && extraAccountId ? getExtraAccountSocket(extraAccountId) : getSocket();
  if (!sock) {
    throw new Error("Nomor WA belum terhubung, tidak bisa mengirim file.");
  }

  const buffer = Buffer.from(fileBase64, "base64");
  const realMimeType = detectRealMimeType(buffer) ?? claimedMimeType;

  // ID pesan ini sudah otomatis ditandai di sentMessageTracker oleh humanSendMessage
  // sendiri sebelum dikirim - lihat wa/humanSend.ts. telegramBuffer/telegramPtt/telegramMime
  // dipakai sekali lagi di bawah untuk notifikasi Telegram - defaultnya sama dengan yang
  // dikirim ke WA, kecuali audio (lihat cabang audio: kalau transcode berhasil, Telegram
  // ikut dapat versi OGG/Opus yang sama, bukan file mentah sebelum diubah).
  let sent: Awaited<ReturnType<typeof humanSendMessage>>;
  let telegramBuffer: Buffer = buffer;
  let telegramMimeType = realMimeType;
  let telegramPtt = false;

  if (realMimeType.startsWith("image/")) {
    sent = await humanSendMessage(sock, waJid, { image: buffer });
  } else if (realMimeType.startsWith("video/")) {
    sent = await humanSendMessage(sock, waJid, { video: buffer, mimetype: realMimeType });
  } else if (realMimeType.startsWith("audio/")) {
    // Diubah ke OGG/Opus dulu (format yang WhatsApp harapkan untuk pesan suara) supaya
    // tampil sebagai bubble "pesan suara" beneran (gelombang + tombol putar), apa pun format
    // asli yang diunggah petugas (webm rekaman browser, mp3, m4a, dst) - lihat
    // media/transcodeAudio.ts. Kalau transcode gagal (mis. ffmpeg tidak ada/berkas rusak),
    // dikirim sebagai dokumen biasa saja daripada gagal total tidak terkirim sama sekali.
    try {
      const oggBuffer = await transcodeToOggOpus(buffer);
      sent = await humanSendMessage(sock, waJid, { audio: oggBuffer, mimetype: "audio/ogg; codecs=opus", ptt: true });
      telegramBuffer = oggBuffer;
      telegramMimeType = "audio/ogg";
      telegramPtt = true;
    } catch (err) {
      logger.warn({ err, waJid }, "Gagal mengubah audio ke format pesan suara, kirim sebagai dokumen biasa");
      sent = await humanSendMessage(sock, waJid, { document: buffer, fileName, mimetype: realMimeType });
    }
  } else {
    sent = await humanSendMessage(sock, waJid, { document: buffer, fileName, mimetype: realMimeType });
  }

  logger.info({ waJid, fileName, realMimeType }, "File terkirim ke warga lewat Pesan Masuk");

  // Notifikasi Telegram (permintaan pemilik) - file-nya sendiri diteruskan (bukan cuma
  // label teks), sama seperti media dari pesan WA asli di forwardTelegramChatActivity.
  if (channel === "EXTRA" && extraAccountId) {
    sendTelegramMediaBuffer(
      extraAccountId,
      telegramBuffer,
      telegramMimeType,
      `✅ Balasan terkirim lewat dashboard (Akun Kedua)\nKe: ${waJid.split("@")[0]}\n\n[File: ${fileName}]`,
      { fileName, ptt: telegramPtt }
    ).catch((err) => logger.warn({ err, waJid, extraAccountId }, "Gagal meneruskan file ke Telegram"));
  }

  return sent?.key?.id ?? undefined;
}
