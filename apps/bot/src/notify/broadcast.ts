import { prisma } from "@kelurahan/db";
import { logger } from "../logger";
import { getSocket } from "../wa/socket";
import { humanSendMessage } from "../wa/humanSend";

const DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dijalankan async tanpa ditunggu control server (bisa makan waktu lama kalau
 * penerimanya banyak). Dikasih jeda antar pesan supaya polanya tidak terlihat
 * seperti spam otomatis ke WhatsApp - broadcast cepat ke banyak nomor sekaligus
 * adalah salah satu pola paling berisiko bikin nomor bot dibatasi/di-ban.
 */
export async function runBroadcast(message: string): Promise<void> {
  const sock = getSocket();
  if (!sock) {
    logger.error("Broadcast dibatalkan: bot WA tidak terhubung.");
    return;
  }

  const rows = await prisma.request.findMany({ distinct: ["waJid"], select: { waJid: true } });
  logger.info({ count: rows.length }, "Memulai broadcast ke warga");

  let sent = 0;
  for (const { waJid } of rows) {
    try {
      await humanSendMessage(sock, waJid, { text: message });
      sent += 1;
    } catch (err) {
      logger.warn({ err, waJid }, "Gagal kirim broadcast ke satu nomor, lanjut ke berikutnya");
    }
    await sleep(DELAY_MS);
  }
  logger.info({ sent, total: rows.length }, "Broadcast selesai");
}
