import path from "path";

const repoRoot = path.resolve(__dirname, "../../../");

export const config = {
  controlPort: Number(process.env.BOT_CONTROL_PORT ?? 4001),
  controlSecret: process.env.BOT_CONTROL_SECRET ?? "dev-secret-change-me",
  uploadDir: path.resolve(repoRoot, process.env.UPLOAD_DIR ?? "./storage/uploads"),
  tmpDir: path.resolve(repoRoot, process.env.TMP_DIR ?? "./storage/tmp"),
  waAuthDir: path.resolve(repoRoot, process.env.WA_AUTH_DIR ?? "./apps/bot/.baileys_auth"),
  // Nomor kedua (perangkat tertaut manual, bukan bot) - folder auth terpisah supaya tidak
  // rebutan sesi dengan nomor layanan utama.
  secondaryWaAuthDir: path.resolve(
    repoRoot,
    process.env.SECONDARY_WA_AUTH_DIR ?? "./apps/bot/.baileys_auth_secondary"
  ),
  maxFileSizeBytes: 10 * 1024 * 1024,
  allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf"],
  conversationTtlHours: 48,
  publicWebUrl: (process.env.PUBLIC_WEB_URL ?? "http://localhost:8450").replace(/\/$/, ""),
  kelurahanName: process.env.KELURAHAN_NAME ?? "Kelurahan",
};
