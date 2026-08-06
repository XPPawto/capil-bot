import type { WASocket } from "@whiskeysockets/baileys";
import { logger } from "../logger";

interface CacheEntry {
  name: string;
  fetchedAt: number;
}

const TTL_MS = 60 * 60_000; // 1 jam - nama grup jarang berubah, tidak perlu ambil ulang tiap pesan
const cache = new Map<string, CacheEntry>();

/**
 * Ambil nama (subject) grup WA, dengan cache in-memory supaya tidak query groupMetadata
 * ke server WA setiap ada pesan baru masuk (grup aktif bisa berkirim puluhan pesan/menit).
 * Kalau gagal diambil (mis. bot baru saja keluar dari grup), fallback ke JID mentahnya
 * saja - bukan best-effort yang bikin pesan gagal tercatat.
 */
export async function getGroupName(sock: WASocket, groupJid: string): Promise<string> {
  const cached = cache.get(groupJid);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.name;
  }
  try {
    const metadata = await sock.groupMetadata(groupJid);
    const name = metadata.subject || groupJid;
    cache.set(groupJid, { name, fetchedAt: Date.now() });
    return name;
  } catch (err) {
    logger.warn({ err, groupJid }, "Gagal mengambil nama grup, pakai JID mentah sebagai fallback");
    return groupJid;
  }
}
