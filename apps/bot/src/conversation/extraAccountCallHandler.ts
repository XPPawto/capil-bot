import type { WACallEvent, WASocket } from "@whiskeysockets/baileys";
import { logger } from "../logger";
import { logInboxCallEvent } from "./messageLog";
import { getGroupName } from "../wa/groupNameCache";

// Baileys mengirim beberapa event untuk satu panggilan yang sama (offer -> ringing ->
// accept/reject/timeout -> terminate) - dedupe per callId supaya cuma dicatat SEKALI,
// pada status hasil akhir pertama yang terdeteksi (bukan tiap event berikutnya).
const handledCallIds = new Set<string>();

/**
 * PENTING (bug nyata yang ditemukan lewat laporan "beberapa history call tidak dicatat"):
 * dulu fungsi ini cuma mengenali 'accept'/'reject'/'timeout' sebagai hasil akhir - padahal
 * dibuktikan lewat data produksi (0 baris "ditolak"/"tidak dijawab" tercatat sama sekali,
 * padahal panggilan tak terjawab pasti pernah terjadi) bahwa WhatsApp/Baileys pada
 * praktiknya mengirim 'terminate' sebagai status akhir untuk panggilan yang TIDAK diangkat
 * (baik ditolak maupun dibiarkan berdering) - 'reject'/'timeout' ternyata jarang/tidak
 * pernah benar-benar sampai ke handler ini. 'terminate' AMAN dipetakan sebagai "tidak
 * diangkat" di sini: kalau panggilannya sungguh diangkat, event 'accept' pasti muncul
 * LEBIH DULU dalam urutan (offer->ringing->accept->...->terminate) dan sudah menandai
 * `handledCallIds`, sehingga 'terminate' susulan untuk callId yang sama otomatis diabaikan
 * oleh pengecekan dedupe di bawah - tidak pernah tertimpa jadi "tidak diangkat" yang keliru.
 */
function outcomeLabel(status: WACallEvent["status"]): string | null {
  if (status === "accept") return "diangkat";
  if (status === "reject") return "ditolak";
  if (status === "timeout") return "tidak dijawab";
  if (status === "terminate") return "tidak diangkat";
  return null;
}

/**
 * Akun EKSTRA bukan bot - panggilan yang masuk TIDAK ditolak otomatis (beda dari nomor
 * layanan di callHandler.ts), dibiarkan berdering normal di HP akun itu supaya benar-benar
 * bisa diangkat manusia seperti panggilan WA biasa. Handler ini murni MENCATAT hasil akhir
 * panggilannya (diangkat/ditolak/tidak dijawab) ke Pesan Masuk, tanpa ikut campur sama
 * sekali dengan panggilannya sendiri.
 */
export async function handleExtraAccountCalls(sock: WASocket, events: WACallEvent[], accountId: number): Promise<void> {
  for (const call of events) {
    // Dicatat MENTAH (semua event, termasuk status yang belum dikenali outcomeLabel) supaya
    // ada jejak di log untuk diagnosis lain kali - sebelumnya event yang tidak dikenali
    // langsung `continue` tanpa jejak sama sekali, itu sebab bug 'terminate' di atas dulu
    // sempat tidak ketahuan lewat log dan baru terbukti lewat query DB langsung. Level
    // "info" (bukan "debug", yang tersaring di produksi secara default) - volume event
    // panggilan rendah, aman dicatat penuh.
    logger.info({ accountId, call }, "Event panggilan akun ekstra diterima (mentah)");

    const outcome = outcomeLabel(call.status);
    if (!outcome) continue;
    if (handledCallIds.has(call.id)) continue;
    handledCallIds.add(call.id);
    setTimeout(() => handledCallIds.delete(call.id), 5 * 60_000);

    // PENTING (bug "panggilan KELUAR dari akun ekstra tidak tercatat, padahal panggilan
    // MASUK tercatat"): `call.from` adalah "call-creator" (lihat rejectCall di Baileys -
    // dipakai persis sebagai JID yang dikirimi balasan reject, artinya itu JID SI PENELEPON).
    // Untuk panggilan MASUK itu kebetulan sama dengan lawan bicara, jadi selama ini
    // kelihatan benar - tapi untuk panggilan KELUAR (akun ekstra ini sendiri yang menelepon
    // dari HP-nya), `call.from` menjadi JID AKUN KITA SENDIRI, bukan warga yang ditelepon,
    // sehingga baris yang tercatat (kalaupun event-nya sampai) nyasar ke JID sendiri -
    // tidak pernah muncul di riwayat warga yang bersangkutan. `call.chatId` dipakai di sini
    // sebagai gantinya - sama seperti `remoteJid` pada pesan biasa, itu identitas PERCAKAPAN
    // yang stabil terlepas dari siapa yang memulai, jadi benar untuk KEDUA arah.
    const waJid = call.chatId || call.from;
    try {
      const groupName = call.isGroup && call.groupJid ? await getGroupName(sock, call.groupJid) : undefined;
      await logInboxCallEvent(
        waJid,
        waJid.split("@")[0],
        Boolean(call.isVideo),
        outcome,
        "EXTRA",
        accountId,
        call.isGroup ? { isGroup: true, groupName: groupName ?? call.groupJid ?? waJid } : undefined
      );
      logger.info({ callId: call.id, waJid, from: call.from, chatId: call.chatId, accountId, outcome }, "Panggilan akun ekstra tercatat");
    } catch (err) {
      logger.warn({ err, callId: call.id, waJid, accountId }, "Gagal mencatat panggilan akun ekstra");
    }
  }
}
