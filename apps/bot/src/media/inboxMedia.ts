import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { downloadMediaMessage, extractMessageContent } from "@whiskeysockets/baileys";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { prisma, type InboxChannel } from "@kelurahan/db";
import { config } from "../config";
import { logger } from "../logger";
import { encryptBuffer } from "./fileEncryption";
import { detectRealMimeType } from "./fileSignature";
import type { GroupMeta } from "../conversation/messageLog";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

const EXT_BY_VIDEO_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
};

/**
 * Foto/dokumen yang dikirim warga direkam apa adanya ke Pesan Masuk (/admin-xpawto),
 * terlepas dari state percakapan yang sedang berjalan - mis. foto iseng, foto KTP yang
 * dikirim sebelum masuk alur formulir resmi, atau lampiran lain di luar konteks pengajuan.
 * Ini TIDAK menggantikan alur resmi pengumpulan syarat (COLLECTING_DOCS di handler.ts) -
 * berkas syarat yang dikirim selagi mengisi formulir tetap JUGA tersimpan lewat jalur itu
 * seperti biasa (RequestDocument); di sini cuma salinan generik demi visibilitas
 * percakapan bagi petugas, disimpan terenkripsi sama seperti berkas syarat lainnya.
 */
export async function logInboxMediaIfPresent(
  sock: WASocket,
  msg: WAMessage,
  waJid: string,
  waNumber: string,
  channel: InboxChannel = "SERVICE",
  group?: GroupMeta,
  direction: "INBOUND" | "OUTBOUND" = "INBOUND"
): Promise<void> {
  const m = extractMessageContent(msg.message ?? undefined) ?? msg.message;
  if (!m) return;
  const isImage = Boolean(m.imageMessage);
  const isDocument = Boolean(m.documentMessage);
  const isVideo = Boolean(m.videoMessage);
  // Audio cuma ditangani di sini untuk channel SECONDARY (nomor kedua tidak punya alur
  // syarat/Request sama sekali). Untuk SERVICE, voice note sudah punya jalur khusus sendiri
  // (media/voiceNote.ts, tersimpan ke RequestMessage) - kalau ikut ditangani di sini juga,
  // hasilnya jadi dobel tampil di thread gabungan /admin-xpawto untuk warga yang sedang
  // punya pengajuan aktif.
  const isAudio = Boolean(m.audioMessage) && channel === "SECONDARY";
  if (!isImage && !isDocument && !isAudio && !isVideo) return;

  try {
    const buffer = (await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { logger: logger.child({ module: "media" }) as any, reuploadRequest: sock.updateMediaMessage }
    )) as Buffer;

    let realMimeType: string | null;
    let ext: string;
    let label: string;
    if (isAudio) {
      // Sama seperti voiceNote.ts: audio tidak divalidasi lewat signature (bukan tipe
      // syarat yang divalidasi ketat), cukup asumsikan ogg (format default WhatsApp).
      realMimeType = "audio/ogg";
      ext = "ogg";
      label = "[Pesan suara]";
    } else if (isVideo) {
      // Sama seperti audio: video bukan tipe syarat yang divalidasi ketat (detectRealMimeType
      // cuma kenal JPEG/PNG/PDF) - dipercaya dari mimetype yang diklaim WhatsApp saja, ini
      // cuma untuk visibilitas percakapan di Pesan Masuk, bukan gerbang keamanan.
      realMimeType = m.videoMessage?.mimetype ?? "video/mp4";
      ext = EXT_BY_VIDEO_MIME[realMimeType] ?? "mp4";
      label = "[Video]";
    } else {
      // Best-effort: kalau isi filenya bukan salah satu dari 3 tipe yang dikenali sistem
      // ini, lewati saja tanpa error - ini cuma catatan tambahan untuk visibilitas, bukan
      // gerbang validasi seperti pada alur upload syarat resmi.
      realMimeType = detectRealMimeType(buffer);
      if (!realMimeType) return;
      ext = EXT_BY_MIME[realMimeType] ?? "bin";
      label = isImage ? "[Foto]" : "[Dokumen]";
    }

    const safeJid = waJid.replace(/[^a-zA-Z0-9._@-]/g, "_");
    const destDir = path.join(config.uploadDir, "_inbox", safeJid);
    await fs.promises.mkdir(destDir, { recursive: true });
    const fileName = `${randomUUID()}.${ext}`;
    await fs.promises.writeFile(path.join(destDir, fileName), encryptBuffer(buffer));

    await prisma.inboxMessage.create({
      data: {
        waJid,
        waNumber,
        channel,
        direction,
        message: label,
        attachmentPath: path.join("_inbox", safeJid, fileName),
        attachmentMimeType: realMimeType,
        isGroup: group?.isGroup ?? false,
        groupName: group?.groupName,
        senderNumber: group?.senderNumber,
        senderName: group?.senderName,
      },
    });
  } catch (err) {
    logger.warn({ err, waJid }, "Gagal menyimpan media warga ke kotak masuk");
  }
}
