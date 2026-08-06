import type { WASocket } from "@whiskeysockets/baileys";
import { logger } from "../logger";

interface CacheEntry {
  name: string;
  fetchedAt: number;
}

const TTL_MS = 60 * 60_000; // 1 jam - sama seperti groupNameCache.ts
const cache = new Map<string, CacheEntry>();

/**
 * Ambil nama Channel WA (JID ...@newsletter), dengan cache in-memory sama seperti
 * wa/groupNameCache.ts. Kalau gagal diambil (mis. metadata tidak tersedia untuk channel
 * itu), fallback ke label generik "Channel" - bukan JID mentah, supaya tetap enak dibaca
 * di /admin-xpawto walau namanya tidak ketemu.
 */
export async function getChannelName(sock: WASocket, channelJid: string): Promise<string> {
  const cached = cache.get(channelJid);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.name;
  }
  try {
    const metadata = await sock.newsletterMetadata("jid", channelJid);
    const name = metadata?.name || "Channel";
    cache.set(channelJid, { name, fetchedAt: Date.now() });
    return name;
  } catch (err) {
    logger.warn({ err, channelJid }, "Gagal mengambil nama channel, pakai label generik sebagai fallback");
    return "Channel";
  }
}
