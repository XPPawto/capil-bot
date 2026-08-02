import Redis from "ioredis";
import { logger } from "../logger";

let client: Redis | undefined;

/**
 * Singleton koneksi Redis (lazy, dibuat sekali dipakai pertama kali). Kalau Redis mati/tidak
 * bisa disambungi, pemanggil (requirementsCache.ts) harus tetap bisa fallback ke MySQL -
 * cache cuma optimisasi kecepatan, BUKAN dependency keras yang boleh bikin bot berhenti total.
 */
export function getRedis(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 200, 2000),
      lazyConnect: false,
    });
    client.on("error", (err) => logger.warn({ err }, "Redis error (bot akan fallback ke query MySQL langsung)"));
  }
  return client;
}
