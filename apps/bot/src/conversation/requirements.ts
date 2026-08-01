import { prisma, ServiceType } from "@kelurahan/db";
import type { RequirementSnapshotItem } from "./types";

export async function loadRequirementsSnapshot(serviceType: ServiceType): Promise<RequirementSnapshotItem[]> {
  const rows = await prisma.requirementTemplate.findMany({
    where: { serviceType, active: true },
    orderBy: { order: "asc" },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, order: r.order }));
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
