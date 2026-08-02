const WINDOW_MS = 10_000;
const MAX_MESSAGES_PER_WINDOW = 20;
const BLOCK_DURATION_MS = 5 * 60 * 1000;

// In-memory per proses - cukup untuk skala satu kelurahan, reset kalau bot restart
// (dampaknya kecil: paling lama nunggu ulang beberapa pesan sebelum limit kena lagi).
const recentTimestamps = new Map<string, number[]>();
const blockedUntil = new Map<string, number>();

export type RateLimitResult = "ok" | "blocked" | "just_blocked";

/**
 * Sliding window sederhana: >20 pesan dari satu nomor dalam 10 detik dianggap
 * flood/spam (baik karena bug di sisi warga - mis. loop kirim ulang - atau upaya
 * sengaja bikin bot kewalahan) - nomor itu didiamkan selama 5 menit.
 */
export function checkRateLimit(waJid: string): RateLimitResult {
  const now = Date.now();

  const until = blockedUntil.get(waJid);
  if (until) {
    if (until > now) return "blocked";
    blockedUntil.delete(waJid);
    recentTimestamps.delete(waJid);
  }

  const timestamps = (recentTimestamps.get(waJid) ?? []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  recentTimestamps.set(waJid, timestamps);

  if (timestamps.length > MAX_MESSAGES_PER_WINDOW) {
    blockedUntil.set(waJid, now + BLOCK_DURATION_MS);
    recentTimestamps.delete(waJid);
    return "just_blocked";
  }

  return "ok";
}
