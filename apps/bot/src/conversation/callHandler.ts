import type { WACallEvent, WASocket } from "@whiskeysockets/baileys";
import { logger } from "../logger";
import { humanSendMessage } from "../wa/humanSend";
import { logInboxCallEvent } from "./messageLog";

const CALL_REJECTED_TEXT =
  "Mohon maaf, nomor ini adalah *Bot Otomatis Kelurahan* dan tidak dapat menerima panggilan suara/video. " +
  "Silakan ketik pertanyaan atau keperluan Anda melalui pesan teks - ketik *menu* untuk memulai.";

// Baileys mengirim beberapa event untuk satu panggilan yang sama (offer -> ringing ->
// timeout/terminate dst) - dedupe per callId supaya reject & pesan penjelasan cuma
// dikirim SEKALI, bukan berulang tiap event status berikutnya masuk.
const handledCallIds = new Set<string>();

/**
 * Panggilan suara/video ke nomor bot publik (baik dari warga bingung maupun iseng) bisa
 * mengganggu stabilitas socket Baileys kalau dibiarkan menggantung - langsung ditolak
 * otomatis begitu status "offer" (panggilan masuk) terdeteksi, disertai penjelasan singkat.
 */
export async function handleIncomingCalls(sock: WASocket, events: WACallEvent[]): Promise<void> {
  for (const call of events) {
    if (call.status !== "offer") continue;
    if (handledCallIds.has(call.id)) continue;
    handledCallIds.add(call.id);
    // Cegah Set tumbuh tanpa batas selama proses hidup lama - id lama tidak perlu diingat.
    setTimeout(() => handledCallIds.delete(call.id), 5 * 60_000);

    // Dicatat dulu (sebelum reject) supaya tetap tercatat di Pesan Masuk meski langkah
    // reject/kirim-pesan di bawah gagal karena sebab apa pun.
    logInboxCallEvent(call.from, call.from.split("@")[0], Boolean(call.isVideo), "ditolak otomatis").catch((err) =>
      logger.warn({ err, callId: call.id, from: call.from }, "Gagal mencatat panggilan masuk ke kotak masuk")
    );

    try {
      await sock.rejectCall(call.id, call.from);
      logger.info({ callId: call.id, from: call.from, isVideo: call.isVideo }, "Panggilan masuk ditolak otomatis");
    } catch (err) {
      logger.warn({ err, callId: call.id, from: call.from }, "Gagal menolak panggilan masuk");
    }

    try {
      await humanSendMessage(sock, call.chatId, { text: CALL_REJECTED_TEXT });
    } catch (err) {
      logger.warn({ err, callId: call.id, from: call.from }, "Gagal kirim pesan penjelasan setelah menolak panggilan");
    }
  }
}
