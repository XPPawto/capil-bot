import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { prisma, ServiceType } from "@kelurahan/db";
import { config } from "../config";
import { logger } from "../logger";
import { decryptBuffer } from "../media/fileEncryption";
import { STATUS_LABEL } from "./statusLabel";
import { loadRequirementsSnapshot, requirementsStatusListText } from "./requirements";
import type { RequirementSnapshotItem, UploadedDocDraft } from "./types";

export interface FixRejectedContext {
  serviceType: ServiceType;
  applicantName: string;
  requirementsSnapshot: RequirementSnapshotItem[];
  uploadedDocs: UploadedDocDraft[];
  rejectionReason: string | null;
  oldTicketNumber: string;
}

/**
 * Dipicu warga lewat "perbaiki <nomor tiket>" untuk pengajuan yang DITOLAK. Menyalin ulang
 * berkas yang sudah pernah dikirim (didekripsi dari storage permanen lama jadi temp file
 * baru) supaya warga tidak perlu kirim ulang SEMUA syarat dari nol - cukup ganti yang
 * bermasalah saja. Kalau requirement lama sudah dihapus/berganti nama sejak pengajuan
 * pertama, slot itu otomatis dianggap kosong (warga tetap harus kirim baru).
 */
export async function loadFixRejectedContext(
  waJid: string,
  rawTicket: string
): Promise<{ ok: false; message: string } | { ok: true; context: FixRejectedContext }> {
  const ticketNumber = rawTicket.trim().toUpperCase();
  const oldRequest = await prisma.request.findUnique({
    where: { ticketNumber },
    include: { documents: true },
  });

  if (!oldRequest || oldRequest.waJid !== waJid) {
    return {
      ok: false,
      message: `Nomor tiket *${ticketNumber}* tidak ditemukan pada riwayat pengajuan Anda. Ketik *status* untuk lihat daftar tiket Anda.`,
    };
  }

  if (oldRequest.status !== "DITOLAK") {
    return {
      ok: false,
      message: `Pengajuan *${ticketNumber}* berstatus *${STATUS_LABEL[oldRequest.status]}*, bukan ditolak - tidak bisa diperbaiki lewat cara ini.`,
    };
  }

  const snapshot = await loadRequirementsSnapshot(oldRequest.serviceType);
  if (snapshot.length === 0) {
    return {
      ok: false,
      message: "Mohon maaf, syarat untuk layanan ini belum tersedia. Silakan hubungi petugas kelurahan.",
    };
  }

  const safeJid = waJid.replace(/[^a-zA-Z0-9._@-]/g, "_");
  const dir = path.join(config.tmpDir, safeJid);
  await fs.promises.mkdir(dir, { recursive: true });

  const uploadedDocs: UploadedDocDraft[] = [];
  for (const item of snapshot) {
    const oldDoc = oldRequest.documents.find((d) => d.requirementName === item.name);
    if (!oldDoc) continue; // syarat ini tidak ada di pengajuan lama (baru ditambahkan admin) - warga kirim baru

    try {
      const encrypted = await fs.promises.readFile(path.join(config.uploadDir, oldDoc.filePath));
      let plain: Buffer;
      try {
        plain = decryptBuffer(encrypted);
      } catch {
        plain = encrypted; // fallback: berkas lama dari sebelum fitur enkripsi ada (sudah plaintext)
      }
      const ext = path.extname(oldDoc.fileName) || "";
      const fileName = `${randomUUID()}${ext}`;
      const tempFilePath = path.join(dir, fileName);
      await fs.promises.writeFile(tempFilePath, plain);

      uploadedDocs.push({
        requirementId: item.id,
        requirementName: item.name,
        tempFilePath,
        fileName,
        mimeType: oldDoc.mimeType,
        ocrNik: oldDoc.ocrNik ?? undefined,
        ocrRawText: oldDoc.ocrRawText ?? undefined,
      });
    } catch (err) {
      logger.warn({ err, oldDoc }, "Gagal menyalin berkas lama saat mode perbaikan, syarat ini perlu dikirim ulang");
    }
  }

  return {
    ok: true,
    context: {
      serviceType: oldRequest.serviceType,
      applicantName: oldRequest.applicantName,
      requirementsSnapshot: snapshot,
      uploadedDocs,
      rejectionReason: oldRequest.rejectionReason,
      oldTicketNumber: oldRequest.ticketNumber,
    },
  };
}

export function fixIntroText(context: FixRejectedContext): string {
  const reasonLine = context.rejectionReason ? `Alasan ditolak sebelumnya: ${context.rejectionReason}\n\n` : "";
  return (
    `Baik, mari perbaiki pengajuan *${context.oldTicketNumber}*.\n\n${reasonLine}` +
    `Syarat yang sudah pernah Anda kirim otomatis dipakai lagi:\n${requirementsStatusListText(context.requirementsSnapshot, context.uploadedDocs)}\n\n` +
    `Ketik *nomor* syarat untuk mengganti/mengisinya (mis. ketik *2*), atau kirim file langsung untuk mengisi syarat yang masih kosong. ` +
    `Kalau semua sudah benar, ketik *lanjut* untuk mengirim ulang pengajuan.`
  );
}
