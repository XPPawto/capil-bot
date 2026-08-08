import type { WASocket } from "@whiskeysockets/baileys";
import { logger } from "../logger";

/**
 * Status online & "sedang mengetik..." (persis WA/Telegram) - MURNI live in-memory, tidak
 * pernah disimpan ke database sama sekali. Beda dari fitur lain di proyek ini (pesan, reaksi,
 * dst) yang semuanya wajib punya jejak audit ledger: presence itu SIFATNYA sekilas/basi
 * dalam hitungan detik, tidak ada nilai historis untuk diaudit - sama seperti BotStatus/
 * status koneksi akun ekstra yang juga live in-memory (getExtraAccountRuntimeStatus).
 *
 * WhatsApp TIDAK mengirim presence kontak begitu saja - harus diminta eksplisit per JID
 * lewat `sock.presenceSubscribe(jid)` (subscribePresence di bawah), dipanggil web SEKALI
 * tiap kali admin membuka satu thread percakapan (lihat /api/inbox/presence/route.ts).
 */
export interface PresenceInfo {
  status: string; // WAPresence: unavailable | available | composing | recording | paused
  lastSeen: number | null; // unix seconds, null kalau kontak tidak membagikan info ini
}

interface PresenceEntry extends PresenceInfo {
  updatedAt: number;
}

const store = new Map<string, PresenceEntry>();

function storeKey(channel: string, extraAccountId: number | undefined, jid: string): string {
  return `${channel}:${extraAccountId ?? 0}:${jid}`;
}

// "composing"/"recording" itu status SEMENTARA - WA sendiri otomatis mengirim update balik
// ke "paused"/"available" begitu orangnya berhenti, TAPI kalau event itu sempat tidak sampai
// (jarang, mis. koneksi terputus sesaat), status "sedang mengetik" bisa "nyangkut" selamanya
// di cache ini. TTL pendek memastikan indikator itu tidak pernah tampil basi lebih dari
// beberapa detik - dianggap kembali ke "paused" begitu kadaluarsa, BUKAN dihapus (lastSeen
// tetap harus ada nilainya).
const STALE_TYPING_MS = 12_000;

/** Didaftarkan SEKALI per socket saat koneksi dibuka (lihat wa/socket.ts &
 * wa/extraAccountManager.ts) - event ini otomatis mengalir untuk JID mana pun yang PERNAH
 * di-subscribe lewat subscribePresence, tidak perlu didaftarkan ulang per-JID. */
export function registerPresenceListener(sock: WASocket, channel: string, extraAccountId?: number): void {
  sock.ev.on("presence.update", ({ id, presences }) => {
    // Cuma dukung chat 1:1 untuk sekarang - grup punya BANYAK partisipan berbeda dari `id`
    // (JID grupnya sendiri), agregasi "siapa saja sedang mengetik" di grup belum didukung.
    const data = presences[id];
    if (!data) return;
    store.set(storeKey(channel, extraAccountId, id), {
      status: data.lastKnownPresence,
      lastSeen: data.lastSeen ?? null,
      updatedAt: Date.now(),
    });
  });
}

export function getPresence(channel: string, extraAccountId: number | undefined, jid: string): PresenceInfo | null {
  const entry = store.get(storeKey(channel, extraAccountId, jid));
  if (!entry) return null;
  const isTyping = entry.status === "composing" || entry.status === "recording";
  if (isTyping && Date.now() - entry.updatedAt > STALE_TYPING_MS) {
    return { status: "paused", lastSeen: entry.lastSeen };
  }
  return { status: entry.status, lastSeen: entry.lastSeen };
}

// Supaya tidak subscribe ulang tiap kali web poll /api/inbox/presence (tiap beberapa detik
// selama thread terbuka) - sekali cukup, WA sendiri yang terus mendorong update selanjutnya.
const subscribed = new Set<string>();

/** Best-effort murni - kegagalan subscribe (jid tidak valid, kontak memblokir privasi, dst)
 * tidak boleh mengganggu apa pun, cukup diabaikan (presence tetap "tidak diketahui"). */
export async function subscribePresenceOnce(
  sock: WASocket,
  channel: string,
  extraAccountId: number | undefined,
  jid: string
): Promise<void> {
  const k = storeKey(channel, extraAccountId, jid);
  if (subscribed.has(k)) return;
  subscribed.add(k);
  try {
    await sock.presenceSubscribe(jid);
  } catch (err) {
    subscribed.delete(k);
    logger.debug({ err, jid }, "Gagal subscribe presence (diabaikan - bukan kegagalan fatal)");
  }
}
