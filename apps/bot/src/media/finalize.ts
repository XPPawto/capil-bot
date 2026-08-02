import fs from "fs";
import path from "path";
import { customAlphabet, nanoid } from "nanoid";
import { prisma, ServiceType } from "@kelurahan/db";
import { config } from "../config";
import { logger } from "../logger";
import { resetConversation } from "../conversation/store";
import type { ConversationContext } from "../conversation/types";
import { encryptBuffer } from "./fileEncryption";
import { generateTicketNumber } from "./ticketNumber";

const pickupTokenAlphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 10);
// Jauh lebih panjang dari pickupToken - ini jadi satu-satunya "kunci" pembuka halaman lacak
// publik (/track/[trackingToken]), harus praktis mustahil ditebak/brute-force.
const trackingTokenAlphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789", 24);

export interface FinalizeResult {
  requestId: string;
  ticketNumber: string;
  trackingToken: string;
}

/**
 * Membuat Request + RequestDocument + StatusHistory (status awal DICEK) dari draft yang
 * terkumpul di ConversationContext, lalu memindahkan file dari storage/tmp ke storage/uploads.
 * DB row dibuat lebih dulu (requestId sudah pasti) baru file dipindah, supaya kalau proses
 * crash di tengah jalan, request tetap tercatat (bukan hilang total).
 */
export async function finalizeRequest(
  waJid: string,
  waNumber: string,
  serviceType: ServiceType,
  applicantName: string,
  context: ConversationContext
): Promise<FinalizeResult> {
  const requestId = nanoid();
  const pickupToken = pickupTokenAlphabet();
  const trackingToken = trackingTokenAlphabet();
  const ticketNumber = await generateTicketNumber(serviceType);

  await prisma.request.create({
    data: {
      id: requestId,
      ticketNumber,
      serviceType,
      applicantName,
      waJid,
      waNumber,
      status: "DICEK",
      pickupToken,
      trackingToken,
      notifiedStatus: "DICEK",
      notifiedAt: new Date(),
      documents: {
        create: context.uploadedDocs.map((doc) => ({
          requirementName: doc.requirementName,
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          filePath: path.join(requestId, doc.fileName),
          ocrNik: doc.ocrNik,
          ocrRawText: doc.ocrRawText,
        })),
      },
      statusHistories: {
        create: { status: "DICEK", note: "Pengajuan lengkap, menunggu pemeriksaan petugas." },
      },
    },
  });

  const destDir = path.join(config.uploadDir, requestId);
  await fs.promises.mkdir(destDir, { recursive: true });

  for (const doc of context.uploadedDocs) {
    const destPath = path.join(destDir, doc.fileName);
    try {
      // Dienkripsi (AES-256-GCM) baru ditulis ke penyimpanan permanen - kalau server
      // ditembus dan folder storage/uploads disalin, isinya cuma bytes acak tanpa kunci.
      const plain = await fs.promises.readFile(doc.tempFilePath);
      const encrypted = encryptBuffer(plain);
      await fs.promises.writeFile(destPath, encrypted);
      await fs.promises.unlink(doc.tempFilePath).catch(() => undefined);
    } catch (err) {
      logger.error({ err, doc }, "Gagal memindahkan/mengenkripsi file syarat ke penyimpanan permanen");
    }
  }

  await resetConversation(waJid);

  return { requestId, ticketNumber, trackingToken };
}
