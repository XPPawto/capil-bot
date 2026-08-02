import { prisma } from "@kelurahan/db";
import { config } from "../config";
import { logger } from "../logger";
import { serviceLabel } from "../conversation/menu";
import type { ConversationContext } from "../conversation/types";
import { formatEstimatedWait } from "../notify/estimateWaitTime";
import { getSocket } from "../wa/socket";
import { humanSendMessage } from "../wa/humanSend";

const INTERVAL_MS = 30 * 60 * 1000; // cek tiap 30 menit
const IDLE_THRESHOLD_HOURS = 6;

/**
 * Warga yang mulai isi formulir/upload syarat tapi berhenti di tengah jalan (males, sinyal
 * putus, lupa) - sebelumnya cuma didiamkan sampai ConversationState-nya kedaluwarsa (48 jam)
 * lalu dihapus tanpa jejak. Reminder ini "menyelamatkan" pengajuan yang sebenarnya niat tapi
 * keburu lupa, dikirim sekali per percakapan (ditandai reminderSentAt) supaya tidak spam.
 */
export function startAbandonedConversationReminder(): void {
  setInterval(() => {
    runOnce().catch((err) => logger.error({ err }, "Gagal menjalankan reminder percakapan belum selesai"));
  }, INTERVAL_MS);
}

async function runOnce(): Promise<void> {
  const sock = getSocket();
  if (!sock) return; // tidak terhubung, coba lagi siklus berikutnya

  // expiresAt selalu di-set ulang ke (interaksi_terakhir + conversationTtlHours) tiap kali
  // warga benar-benar berinteraksi (lihat store.ts saveConversation) - jadi expiresAt yang
  // masih kurang dari (conversationTtlHours - IDLE_THRESHOLD_HOURS) jam dari sekarang berarti
  // interaksi terakhirnya sudah lebih dari IDLE_THRESHOLD_HOURS jam yang lalu.
  const reminderCutoff = new Date(
    Date.now() + (config.conversationTtlHours - IDLE_THRESHOLD_HOURS) * 60 * 60 * 1000
  );

  const candidates = await prisma.conversationState.findMany({
    where: {
      state: { in: ["AWAIT_NAME", "COLLECTING_DOCS", "FIXING_REJECTED"] },
      reminderSentAt: null,
      expiresAt: { lt: reminderCutoff, gt: new Date() },
    },
  });

  for (const conv of candidates) {
    try {
      const context = (conv.contextJson ?? {}) as unknown as ConversationContext;
      const label = context.serviceType ? serviceLabel(context.serviceType) : "yang sedang Anda ajukan";
      const remainingMinutes = Math.max(1, Math.round((conv.expiresAt.getTime() - Date.now()) / 60_000));

      await humanSendMessage(sock, conv.waJid, {
        text:
          `Halo, sepertinya pengajuan *${label}* Anda belum selesai.\n\n` +
          `Lanjutkan dengan mengirim syarat yang masih diminta, atau ketik *menu* untuk mulai ulang.\n\n` +
          `Kalau tidak dilanjutkan, data ini akan otomatis dihapus dalam sekitar *${formatEstimatedWait(remainingMinutes)}*.`,
      });
      await prisma.conversationState.update({ where: { id: conv.id }, data: { reminderSentAt: new Date() } });
      logger.info({ waJid: conv.waJid }, "Reminder percakapan belum selesai terkirim");
    } catch (err) {
      logger.warn({ err, waJid: conv.waJid }, "Gagal kirim reminder percakapan belum selesai");
    }
  }
}
