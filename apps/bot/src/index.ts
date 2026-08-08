import { logger } from "./logger";
import { startControlServer } from "./server/controlServer";
import { startReconciler } from "./notify/reconciler";
import { startExpiredConversationCleanup } from "./jobs/expireConversations";
import { startPickupReminderJob } from "./jobs/remindPendingPickup";
import { startAbandonedConversationReminder } from "./jobs/remindAbandonedConversations";
import { warmRequirementsCache } from "./conversation/requirements";
import { startTelegramCommandListener } from "./notify/telegramCommands";
import { startSocket } from "./wa/socket";
import { markBotDisconnected } from "./wa/connection";
import { markAllExtraAccountsDisconnected, startAllExtraAccountSockets } from "./wa/extraAccountManager";

async function main(): Promise<void> {
  startControlServer();
  startTelegramCommandListener();
  startReconciler();
  startExpiredConversationCleanup();
  startPickupReminderJob();
  startAbandonedConversationReminder();
  warmRequirementsCache().catch((err) => logger.warn({ err }, "Gagal warm-up cache syarat, akan diisi lazy per-request"));
  await startSocket({ type: "qr" });
  // Akun-akun ekstra (bukan bot) - yang sudah pernah ditautkan sebelumnya otomatis
  // menyambung ulang pakai kredensial tersimpan. Yang belum pernah (baru dibuat, belum
  // discan QR-nya) tetap idle sampai admin membuka tab-nya di /admin-xpawto - lihat
  // wa/extraAccountManager.ts.
  await startAllExtraAccountSockets().catch((err: unknown) =>
    logger.error({ err }, "Gagal menyambungkan ulang akun-akun ekstra")
  );
  logger.info("Bot kelurahan siap. Jika belum tertaut, scan QR yang muncul di terminal atau lewat dashboard /bot.");
}

main().catch((err) => {
  logger.error({ err }, "Gagal menjalankan bot");
  process.exit(1);
});

// Supaya dashboard tidak menampilkan "Terhubung" basi saat proses ini dihentikan
// secara normal (mis. `pm2 restart`/`pm2 stop`). Crash mendadak (OOM/SIGKILL)
// tetap tidak bisa ditangkap di sini - itu ditangani lewat auto-restart PM2
// + status live dari control server, bukan dari kolom BotSession semata.
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Menerima sinyal shutdown, menandai bot terputus...");
  try {
    await markBotDisconnected();
    await markAllExtraAccountsDisconnected();
  } catch (err) {
    logger.error({ err }, "Gagal menandai bot terputus saat shutdown");
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
