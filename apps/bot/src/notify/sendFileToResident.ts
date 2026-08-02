import { prisma } from "@kelurahan/db";
import { serviceLabel } from "../conversation/menu";
import { detectRealMimeType } from "../media/fileSignature";
import { logger } from "../logger";
import { getSocket } from "../wa/socket";
import { humanSendMessage } from "../wa/humanSend";

/**
 * Petugas kirim dokumen digital (soft file - mis. scan KK/Akte final) ke warga lewat WA,
 * dipicu manual dari dashboard. Sama seperti upload warga, mimetype diverifikasi dari isi
 * file asli (magic bytes) - bukan cuma dipercaya dari klaim browser - supaya kalau ada
 * mismatch, dokumen tetap terkirim dengan jenis pesan WA yang benar (image vs document).
 */
export async function sendFileToResident(
  requestId: string,
  fileName: string,
  claimedMimeType: string,
  fileBase64: string
): Promise<void> {
  const sock = getSocket();
  if (!sock) {
    throw new Error("Bot WA belum terhubung, tidak bisa mengirim file.");
  }

  const req = await prisma.request.findUnique({ where: { id: requestId } });
  if (!req) {
    throw new Error("Pengajuan tidak ditemukan.");
  }

  const buffer = Buffer.from(fileBase64, "base64");
  const realMimeType = detectRealMimeType(buffer) ?? claimedMimeType;

  const caption = `Dokumen *${serviceLabel(req.serviceType)}* Anda (No. Tiket: *${req.ticketNumber}*) dari petugas kelurahan.`;

  if (realMimeType.startsWith("image/")) {
    await humanSendMessage(sock, req.waJid, { image: buffer, caption });
  } else {
    await humanSendMessage(sock, req.waJid, { document: buffer, fileName, mimetype: realMimeType, caption });
  }

  logger.info({ requestId, fileName, realMimeType }, "File dokumen terkirim ke warga");
}
