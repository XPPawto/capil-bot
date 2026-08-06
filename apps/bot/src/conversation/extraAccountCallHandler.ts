import type { WACallEvent, WASocket } from "@whiskeysockets/baileys";
import { logger } from "../logger";
import { logInboxCallEvent } from "./messageLog";

// Baileys mengirim beberapa event untuk satu panggilan yang sama (offer -> ringing ->
// accept/reject/timeout -> terminate) - dedupe per callId supaya cuma dicatat SEKALI,
// pada status hasil akhir pertama yang terdeteksi (bukan tiap event berikutnya).
const handledCallIds = new Set<string>();

function outcomeLabel(status: WACallEvent["status"]): string | null {
  if (status === "accept") return "diangkat";
  if (status === "reject") return "ditolak";
  if (status === "timeout") return "tidak dijawab";
  return null;
}

/**
 * Akun EKSTRA bukan bot - panggilan yang masuk TIDAK ditolak otomatis (beda dari nomor
 * layanan di callHandler.ts), dibiarkan berdering normal di HP akun itu supaya benar-benar
 * bisa diangkat manusia seperti panggilan WA biasa. Handler ini murni MENCATAT hasil akhir
 * panggilannya (diangkat/ditolak/tidak dijawab) ke Pesan Masuk, tanpa ikut campur sama
 * sekali dengan panggilannya sendiri.
 */
export async function handleExtraAccountCalls(_sock: WASocket, events: WACallEvent[], accountId: number): Promise<void> {
  for (const call of events) {
    const outcome = outcomeLabel(call.status);
    if (!outcome) continue;
    if (handledCallIds.has(call.id)) continue;
    handledCallIds.add(call.id);
    setTimeout(() => handledCallIds.delete(call.id), 5 * 60_000);

    try {
      await logInboxCallEvent(call.from, call.from.split("@")[0], Boolean(call.isVideo), outcome, "EXTRA", accountId);
      logger.info({ callId: call.id, from: call.from, accountId, outcome }, "Panggilan akun ekstra tercatat");
    } catch (err) {
      logger.warn({ err, callId: call.id, from: call.from, accountId }, "Gagal mencatat panggilan akun ekstra");
    }
  }
}
