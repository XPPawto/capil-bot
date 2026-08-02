import Redis from "ioredis";

let client: Redis | undefined;

function getRedis(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      lazyConnect: false,
    });
    client.on("error", () => {
      // diamkan - invalidasi cache cuma optimisasi, kegagalan di sini tidak boleh
      // menggagalkan aksi admin (CRUD syarat tetap harus jalan walau Redis mati).
      // Bot tetap aman berkat TTL cache di sisi bot sebagai jaring pengaman.
    });
  }
  return client;
}

/** Dipanggil bot lewat key "kelurahan:requirements:<ServiceType>" (lihat requirementsCache.ts
 * di apps/bot) - dihapus di sini tiap admin ubah syarat, supaya bot langsung query MySQL
 * ulang di request berikutnya alih-alih menunggu TTL habis. */
export async function invalidateRequirementsCache(serviceType: string): Promise<void> {
  try {
    await getRedis().del(`kelurahan:requirements:${serviceType}`);
  } catch {
    // best-effort, lihat komentar di atas
  }
}
