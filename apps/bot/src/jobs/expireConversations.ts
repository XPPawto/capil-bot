import fs from "fs";
import path from "path";
import { prisma } from "@kelurahan/db";
import { config } from "../config";
import { logger } from "../logger";

const INTERVAL_MS = 60 * 60 * 1000; // 1 jam

/**
 * Warga yang meninggalkan percakapan di tengah jalan (mis. lupa lanjut upload)
 * tidak boleh terkunci selamanya di state lama. Bersihkan ConversationState
 * + file sementara yang sudah lewat expiresAt (default 48 jam sejak interaksi terakhir).
 */
export function startExpiredConversationCleanup(): void {
  setInterval(() => {
    runOnce().catch((err) => logger.error({ err }, "Gagal membersihkan ConversationState kedaluwarsa"));
  }, INTERVAL_MS);
}

async function runOnce(): Promise<void> {
  const expired = await prisma.conversationState.findMany({
    where: { expiresAt: { lt: new Date() } },
  });

  if (expired.length === 0) return;

  for (const conv of expired) {
    const safeJid = conv.waJid.replace(/[^a-zA-Z0-9._@-]/g, "_");
    const dir = path.join(config.tmpDir, safeJid);
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }

  await prisma.conversationState.deleteMany({ where: { id: { in: expired.map((c) => c.id) } } });
  logger.info({ count: expired.length }, "ConversationState kedaluwarsa + file sementara dibersihkan");
}
