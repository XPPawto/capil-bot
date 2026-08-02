import type { AnyMessageContent, WASocket } from "@whiskeysockets/baileys";

const MIN_DELAY_MS = 2000;
const MAX_DELAY_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Box-Muller transform - jeda berbasis distribusi normal, bukan uniform, supaya polanya
 * tidak terlihat seperti timer statis/robotic kalau diperhatikan dalam jumlah besar. */
function gaussianRandom(mean: number, stdDev: number): number {
  const u1 = Math.random() || Number.EPSILON;
  const u2 = Math.random();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z0 * stdDev;
}

function jitterDelayMs(): number {
  const mean = (MIN_DELAY_MS + MAX_DELAY_MS) / 2;
  const stdDev = (MAX_DELAY_MS - MIN_DELAY_MS) / 4;
  const value = Math.round(gaussianRandom(mean, stdDev));
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, value));
}

/**
 * Pengganti sock.sendMessage langsung: memicu presence "composing" (efek "mengetik...")
 * lalu menunggu jeda acak sebelum benar-benar mengirim, supaya balasan bot tidak terlihat
 * instan/kaku ke sistem deteksi otomasi WhatsApp. Ini mitigasi risiko ban, bukan jaminan -
 * Baileys tetap unofficial client, tapi pola pengiriman yang lebih "manusiawi" mengurangi
 * salah satu sinyal paling gampang dipakai untuk mendeteksi bot.
 */
export async function humanSendMessage(
  sock: WASocket,
  jid: string,
  content: AnyMessageContent
): ReturnType<WASocket["sendMessage"]> {
  try {
    await sock.sendPresenceUpdate("composing", jid);
  } catch {
    // presence gagal tidak boleh menghalangi pengiriman pesan sesungguhnya
  }

  await sleep(jitterDelayMs());

  try {
    await sock.sendPresenceUpdate("paused", jid);
  } catch {
    // ignore
  }

  return sock.sendMessage(jid, content);
}
