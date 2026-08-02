import { ServiceType } from "@kelurahan/db";
import { logger } from "../logger";
import type { RequirementSnapshotItem } from "../conversation/types";
import { getRedis } from "./redis";

const KEY_PREFIX = "kelurahan:requirements:";
// Jaring pengaman kalau invalidasi dari web (DEL saat admin ubah syarat) entah kenapa
// tidak sampai (mis. Redis restart di antara) - cache tidak akan basi selamanya.
const TTL_SECONDS = 10 * 60;

function cacheKey(serviceType: ServiceType): string {
  return `${KEY_PREFIX}${serviceType}`;
}

export async function getCachedRequirements(serviceType: ServiceType): Promise<RequirementSnapshotItem[] | null> {
  try {
    const raw = await getRedis().get(cacheKey(serviceType));
    return raw ? (JSON.parse(raw) as RequirementSnapshotItem[]) : null;
  } catch (err) {
    logger.warn({ err, serviceType }, "Gagal baca cache Redis, lanjut query MySQL langsung");
    return null;
  }
}

export async function setCachedRequirements(serviceType: ServiceType, items: RequirementSnapshotItem[]): Promise<void> {
  try {
    await getRedis().set(cacheKey(serviceType), JSON.stringify(items), "EX", TTL_SECONDS);
  } catch (err) {
    logger.warn({ err, serviceType }, "Gagal tulis cache Redis (tidak fatal, request berikutnya query MySQL lagi)");
  }
}
