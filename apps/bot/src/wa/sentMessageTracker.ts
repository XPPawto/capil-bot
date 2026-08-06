/**
 * Melacak ID pesan yang baru saja dikirim LEWAT DASHBOARD (sendInboxReply/sendInboxFile),
 * supaya secondaryMessageHandler.ts bisa membedakan dua jenis event "fromMe" yang masuk
 * lewat messages.upsert:
 *
 *  1. Echo dari pesan yang memang kita kirim sendiri lewat dashboard - sudah dicatat ke DB
 *     sebelum dikirim (lihat route ../[waJid]/messages), jadi kalau ikut dicatat lagi di
 *     sini hasilnya dobel. ID-nya ada di set ini -> dilewati.
 *  2. Balasan yang diketik LANGSUNG dari HP nomor kedua (bukan lewat dashboard) - WhatsApp
 *     multi-device tetap mengirim event ini ke kita sebagai perangkat tertaut, TAPI ID-nya
 *     tidak pernah kita catat duluan -> ini yang justru perlu direkam sebagai balasan baru,
 *     supaya kelihatan juga di /admin-xpawto (permintaan: petugas kadang balas langsung
 *     dari WA asli, bukan cuma lewat web).
 */
const recentlySentIds = new Set<string>();
const TTL_MS = 5 * 60_000;

export function markAsSentByDashboard(messageId: string | null | undefined): void {
  if (!messageId) return;
  recentlySentIds.add(messageId);
  setTimeout(() => recentlySentIds.delete(messageId), TTL_MS);
}

export function wasSentByDashboard(messageId: string | null | undefined): boolean {
  return Boolean(messageId && recentlySentIds.has(messageId));
}
