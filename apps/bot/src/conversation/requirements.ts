import { prisma, ServiceType } from "@kelurahan/db";
import { getCachedRequirements, setCachedRequirements } from "../cache/requirementsCache";
import type { RequirementSnapshotItem } from "./types";

/**
 * Cache-through Redis: syarat aktif per layanan dibaca dulu dari RAM (Redis) sebelum
 * menyentuh MySQL sama sekali - dipanggil tiap warga pilih layanan/buka menu, jadi kalau
 * banyak warga akses bersamaan, MySQL tidak ikut kena beban query berulang untuk data
 * yang sama. Cache di-invalidasi aktif oleh web (DEL) tiap admin ubah syarat, dengan TTL
 * sebagai jaring pengaman kalau invalidasi itu entah kenapa tidak sampai.
 */
export async function loadRequirementsSnapshot(serviceType: ServiceType): Promise<RequirementSnapshotItem[]> {
  const cached = await getCachedRequirements(serviceType);
  if (cached) return cached;

  const rows = await prisma.requirementTemplate.findMany({
    where: { serviceType, active: true },
    orderBy: { order: "asc" },
  });
  const items = rows.map((r) => ({ id: r.id, name: r.name, order: r.order, ocrKtp: r.ocrKtp }));
  await setCachedRequirements(serviceType, items);
  return items;
}

/** Dipanggil sekali saat bot menyala - isi cache lebih dulu supaya warga pertama yang
 * buka menu tidak ikut menanggung query MySQL (langsung dapat cache hit). */
export async function warmRequirementsCache(): Promise<void> {
  const serviceTypes: ServiceType[] = ["KARTU_KELUARGA", "AKTE_KEMATIAN", "AKTE_KELAHIRAN"];
  await Promise.all(serviceTypes.map((s) => loadRequirementsSnapshot(s)));
}

export function requirementsListText(items: RequirementSnapshotItem[]): string {
  return items.map((r, idx) => `${idx + 1}. ${r.name}`).join("\n");
}

export function nextPendingRequirement(
  snapshot: RequirementSnapshotItem[],
  uploadedRequirementIds: number[]
): RequirementSnapshotItem | undefined {
  return snapshot.find((r) => !uploadedRequirementIds.includes(r.id));
}
