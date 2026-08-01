import fs from "fs";
import path from "path";
import { customAlphabet, nanoid } from "nanoid";
import { prisma, ServiceType } from "@kelurahan/db";
import { config } from "../config";
import { logger } from "../logger";
import { resetConversation } from "../conversation/store";
import type { ConversationContext } from "../conversation/types";
import { generateTicketNumber } from "./ticketNumber";

const pickupTokenAlphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 10);

export interface FinalizeResult {
  requestId: string;
  ticketNumber: string;
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
      notifiedStatus: "DICEK",
      notifiedAt: new Date(),
      documents: {
        create: context.uploadedDocs.map((doc) => ({
          requirementName: doc.requirementName,
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          filePath: path.join(requestId, doc.fileName),
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
      await fs.promises.rename(doc.tempFilePath, destPath);
    } catch (err) {
      logger.error({ err, doc }, "Gagal memindahkan file syarat ke penyimpanan permanen");
    }
  }

  await resetConversation(waJid);

  return { requestId, ticketNumber };
}
