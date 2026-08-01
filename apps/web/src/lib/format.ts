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
  DICEK: "bg-amber-100 text-amber-800",
  DIPROSES: "bg-blue-100 text-blue-800",
  DITOLAK: "bg-red-100 text-red-800",
  SELESAI: "bg-green-100 text-green-800",
};

export function serviceLabel(serviceType: ServiceType): string {
  return SERVICE_LABELS[serviceType] ?? serviceType;
}

export function statusLabel(status: RequestStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function statusBadgeClass(status: RequestStatus): string {
  return STATUS_BADGE_CLASS[status] ?? "bg-neutral-100 text-neutral-800";
}

export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}
