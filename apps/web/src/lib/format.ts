import type { RequestStatus, ServiceType } from "@kelurahan/db";

const SERVICE_LABELS: Record<ServiceType, string> = {
  KARTU_KELUARGA: "Kartu Keluarga",
  AKTE_KEMATIAN: "Akte Kematian",
  AKTE_KELAHIRAN: "Akte Kelahiran",
};

const STATUS_LABELS: Record<RequestStatus, string> = {
  DICEK: "Dicek",
  DIPROSES: "Diproses",
  DITOLAK: "Ditolak",
  SELESAI: "Selesai",
};

const STATUS_BADGE_CLASS: Record<RequestStatus, string> = {
  DICEK: "bg-pastel-yellow text-pastel-yellow-ink",
  DIPROSES: "bg-pastel-blue text-pastel-blue-ink",
  DITOLAK: "bg-pastel-red text-pastel-red-ink",
  SELESAI: "bg-pastel-green text-pastel-green-ink",
};

export function serviceLabel(serviceType: ServiceType): string {
  return SERVICE_LABELS[serviceType] ?? serviceType;
}

export function statusLabel(status: RequestStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function statusBadgeClass(status: RequestStatus): string {
  return STATUS_BADGE_CLASS[status] ?? "bg-canvas text-ink-muted";
}

export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

/** Estimasi lama menunggu dalam bahasa manusia, mis. "3 hari", "5 jam", "baru saja". */
export function relativeDuration(date: Date | string): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam`;
  const days = Math.floor(hours / 24);
  return `${days} hari`;
}
