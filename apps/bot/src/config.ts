import path from "path";

const repoRoot = path.resolve(__dirname, "../../../");

export const config = {
  controlPort: Number(process.env.BOT_CONTROL_PORT ?? 4001),
  controlSecret: process.env.BOT_CONTROL_SECRET ?? "dev-secret-change-me",
  uploadDir: path.resolve(repoRoot, process.env.UPLOAD_DIR ?? "./storage/uploads"),
  tmpDir: path.resolve(repoRoot, process.env.TMP_DIR ?? "./storage/tmp"),
  waAuthDir: path.resolve(repoRoot, process.env.WA_AUTH_DIR ?? "./apps/bot/.baileys_auth"),
  // Akun-akun ekstra (perangkat tertaut manual, bukan bot) - satu subfolder per akun
  // (.../<ExtraAccount.id>/), supaya tiap akun punya sesi Baileys sendiri-sendiri, tidak
  // rebutan satu sama lain maupun dengan nomor layanan utama.
  extraAccountAuthDir: path.resolve(repoRoot, process.env.EXTRA_ACCOUNT_AUTH_DIR ?? "./apps/bot/.baileys_auth_extra"),
  maxFileSizeBytes: 10 * 1024 * 1024,
  allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf"],
  conversationTtlHours: 48,
  publicWebUrl: (process.env.PUBLIC_WEB_URL ?? "http://localhost:8450").replace(/\/$/, ""),
  kelurahanName: process.env.KELURAHAN_NAME ?? "Kelurahan",
  // Notifikasi Telegram permintaan pemilik - lihat notify/telegramNotify.ts. Kosong berarti
  // fitur ini nonaktif (tidak error, cuma tidak mengirim apa-apa).
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    notifyChatId: process.env.TELEGRAM_NOTIFY_CHAT_ID,
  },
};
