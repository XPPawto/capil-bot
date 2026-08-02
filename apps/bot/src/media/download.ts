import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { downloadMediaMessage, extractMessageContent } from "@whiskeysockets/baileys";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { config } from "../config";
import { logger } from "../logger";
import { detectRealMimeType } from "./fileSignature";

export class MediaRejectedError extends Error {}

interface MediaInfo {
  mimetype: string;
  fileLength?: number;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

function numberFrom(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null && "toNumber" in (v as Record<string, unknown>)) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

function extractMediaInfo(msg: WAMessage): MediaInfo | undefined {
  // WhatsApp sering membungkus dokumen (termasuk PDF) dalam documentWithCaptionMessage
  // (bukan cuma saat ada caption - beberapa versi WA client selalu memakainya untuk
  // kiriman "Dokumen"). Tanpa dibuka bungkusnya dulu, documentMessage tidak akan
  // ketemu sama sekali dan bot akan mengira warga tidak mengirim file yang didukung.
  const m = extractMessageContent(msg.message ?? undefined) ?? msg.message;
  if (!m) return undefined;
  if (m.imageMessage) {
    return { mimetype: m.imageMessage.mimetype ?? "image/jpeg", fileLength: numberFrom(m.imageMessage.fileLength) };
  }
  if (m.documentMessage) {
    return {
      mimetype: m.documentMessage.mimetype ?? "application/octet-stream",
      fileLength: numberFrom(m.documentMessage.fileLength),
    };
  }
  return undefined;
}

export function hasSupportedMedia(msg: WAMessage): boolean {
  return extractMediaInfo(msg) !== undefined;
}

export async function downloadAndValidate(
  sock: WASocket,
  msg: WAMessage,
  waJid: string
): Promise<{ tempFilePath: string; fileName: string; mimeType: string }> {
  const info = extractMediaInfo(msg);
  if (!info) {
    throw new MediaRejectedError("Mohon kirim file berupa foto (JPG/PNG) atau PDF.");
  }
  if (!config.allowedMimeTypes.includes(info.mimetype)) {
    throw new MediaRejectedError("Format file tidak didukung. Mohon kirim foto (JPG/PNG) atau PDF.");
  }
  if (info.fileLength && info.fileLength > config.maxFileSizeBytes) {
    throw new MediaRejectedError("Ukuran file terlalu besar (maks 10MB). Mohon kirim ulang dengan ukuran lebih kecil.");
  }

  let buffer: Buffer;
  try {
    buffer = (await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { logger: logger.child({ module: "media" }) as any, reuploadRequest: sock.updateMediaMessage }
    )) as Buffer;
  } catch (err) {
    logger.error({ err }, "Gagal mengunduh media dari warga");
    throw new MediaRejectedError("Gagal mengunduh file, kemungkinan koneksi terputus. Mohon kirim ulang.");
  }

  if (buffer.length > config.maxFileSizeBytes) {
    throw new MediaRejectedError("Ukuran file terlalu besar (maks 10MB). Mohon kirim ulang dengan ukuran lebih kecil.");
  }

  // Jangan percaya klaim mimetype dari WhatsApp (metadata dari klien pengirim, bisa
  // dipalsukan - file berbahaya diganti ekstensi/mimetype-nya jadi terlihat seperti
  // foto). Verifikasi dari signature byte isi filenya sendiri (ground truth), tolak
  // kalau tidak cocok salah satu dari 3 tipe yang diizinkan - terlepas dari klaimnya.
  const realMimeType = detectRealMimeType(buffer);
  if (!realMimeType || !config.allowedMimeTypes.includes(realMimeType)) {
    logger.warn(
      { waJid, claimedMimeType: info.mimetype, detectedMimeType: realMimeType },
      "File ditolak: isi file tidak cocok signature JPEG/PNG/PDF (kemungkinan percobaan file masquerading)"
    );
    throw new MediaRejectedError("Format file tidak dikenali atau tidak didukung. Mohon kirim foto (JPG/PNG) atau PDF asli.");
  }
  if (realMimeType !== info.mimetype) {
    logger.warn(
      { waJid, claimedMimeType: info.mimetype, detectedMimeType: realMimeType },
      "Mimetype yang diklaim WhatsApp tidak cocok dengan isi file asli - dipakai hasil deteksi signature, bukan klaimnya"
    );
  }

  const ext = EXT_BY_MIME[realMimeType] ?? "bin";
  const safeJid = waJid.replace(/[^a-zA-Z0-9._@-]/g, "_");
  const dir = path.join(config.tmpDir, safeJid);
  await fs.promises.mkdir(dir, { recursive: true });
  const fileName = `${randomUUID()}.${ext}`;
  const tempFilePath = path.join(dir, fileName);
  await fs.promises.writeFile(tempFilePath, buffer);

  return { tempFilePath, fileName, mimeType: realMimeType };
}
