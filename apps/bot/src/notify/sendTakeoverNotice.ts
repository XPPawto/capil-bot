import { logger } from "../logger";
import { getSocket } from "../wa/socket";
import { humanSendMessage } from "../wa/humanSend";

const ACTIVATED_TEXT =
  "Anda sekarang terhubung *langsung dengan petugas kami*. Petugas akan membalas pesan Anda secara manual mulai sekarang.";
const DEACTIVATED_TEXT =
  "Anda kembali terhubung dengan asisten otomatis kami. Ketik *menu* untuk melihat pilihan layanan, atau *status* untuk cek status pengajuan.";

/**
 * Dikirim ke warga tepat saat petugas menekan toggle "Ambil Alih" / "Lepas" di dashboard,
 * supaya warga sadar sedang bicara dengan manusia (bukan bot) atau sudah kembali ke bot -
 * bukan cuma bot diam-diam berhenti/mulai membalas tanpa penjelasan.
 */
export async function sendTakeoverNotice(waJid: string, active: boolean): Promise<void> {
  const sock = getSocket();
  if (!sock) {
    throw new Error("Bot WA belum terhubung, tidak bisa mengirim notifikasi.");
  }

  await humanSendMessage(sock, waJid, { text: active ? ACTIVATED_TEXT : DEACTIVATED_TEXT });
  logger.info({ waJid, active }, "Notifikasi ambil-alih percakapan terkirim ke warga");
}
