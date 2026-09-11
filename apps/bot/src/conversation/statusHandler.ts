import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { downloadMediaMessage, extractMessageContent } from "@whiskeysockets/baileys";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { prisma } from "@kelurahan/db";
import { config } from "../config";
import { logger } from "../logger";
import { encryptBuffer } from "../media/fileEncryption";
import { detectRealMimeType } from "../media/fileSignature";
import { resolveKnownWaNumber } from "./messageLog";
import { historyMessageTimestamp } from "./messageHandler";

const EXT_BY_IMAGE_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};
const EXT_BY_VIDEO_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
};

/**
 * Status/Story WA warga yang dibagikan ke akun ekstra ini - lihat komentar model
 * ContactStatusUpdate di schema.prisma untuk alasan lengkap kenapa ini SENGAJA cuma
 * mencatat PASIF, TIDAK PERNAH mengirim tanda "sudah dilihat" balik ke warga - tidak ada
 * satu baris kode pun di sini (atau di mana pun di proyek ini - lihat grep `readMessages`,
 * tidak ada satu pun pemanggilannya) yang memicu receipt "viewed" ke WhatsApp.
 *
 * `status@broadcast` sendiri cuma alamat broadcast list, bukan identitas siapa pun -
 * pemilik status asli ada di `msg.key.participant`, persis seperti `participant` di pesan
 * grup (`remoteJid` grup vs pengirim aslinya).
 */
export async function handleExtraAccountStatusUpdate(sock: WASocket, msg: WAMessage, accountId: number): Promise<void> {
  const waJid = msg.key.participant;
  if (!waJid || msg.key.fromMe || !msg.message) return;

  const raw = msg.message;
  const m = extractMessageContent(raw) ?? raw;
  const isImage = Boolean(m.imageMessage);
  const isVideo = Boolean(m.videoMessage);
  const text = m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.videoMessage?.caption ?? undefined;
  // Tipe status yang tidak dikenali di sini (mis. audio status, jarang dipakai) - lewati,
  // tidak ada yang berarti untuk dicatat.
  if (!isImage && !isVideo && !text) return;

  const postedAt = historyMessageTimestamp(msg) ?? new Date();
  const waNumber = (await resolveKnownWaNumber(waJid)) ?? waJid.split("@")[0];

  let attachmentPath: string | undefined;
  let attachmentMimeType: string | undefined;
  let contentType: "text" | "image" | "video" = "text";

  if (isImage || isVideo) {
    try {
      const buffer = (await downloadMediaMessage(
        msg,
        "buffer",
        {},
        { logger: logger.child({ module: "media-status" }) as any, reuploadRequest: sock.updateMediaMessage }
      )) as Buffer;

      let realMimeType: string;
      let ext: string;
      if (isVideo) {
        realMimeType = m.videoMessage?.mimetype ?? "video/mp4";
        ext = EXT_BY_VIDEO_MIME[realMimeType] ?? "mp4";
        contentType = "video";
      } else {
        realMimeType = detectRealMimeType(buffer) ?? "image/jpeg";
        ext = EXT_BY_IMAGE_MIME[realMimeType] ?? "jpg";
        contentType = "image";
      }

      const destDir = path.join(config.uploadDir, "_status", String(accountId));
      await fs.promises.mkdir(destDir, { recursive: true });
      const fileName = `${randomUUID()}.${ext}`;
      await fs.promises.writeFile(path.join(destDir, fileName), encryptBuffer(buffer));
      attachmentPath = path.join("_status", String(accountId), fileName);
      attachmentMimeType = realMimeType;
    } catch (err) {
      logger.warn({ err, waJid, accountId }, "Gagal mengunduh media status");
      if (!text) return; // media gagal & tidak ada caption sama sekali - tidak ada yang bisa dicatat
    }
  }

  try {
    await prisma.contactStatusUpdate.create({
      data: {
        waJid,
        waNumber,
        channel: "EXTRA",
        extraAccountId: accountId,
        contentType,
        text: text ?? null,
        attachmentPath,
        attachmentMimeType,
        postedAt,
      },
    });
    logger.info({ waJid, accountId, contentType }, "Status warga tercatat (pasif, tanpa tanda dilihat)");
  } catch (err) {
    logger.error({ err, waJid, accountId }, "Gagal mencatat status warga");
  }
}
