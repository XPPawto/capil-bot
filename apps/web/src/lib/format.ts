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

/**
 * Bobot urgensi per layanan untuk priority queue di halaman Antrian - Akte Kematian
 * biasanya dibutuhkan mendesak (pemakaman/klaim asuransi), jadi disodok ke atas
 * antrian meski masuknya belakangan dibanding KK yang tidak mendesak.
 */
const SERVICE_PRIORITY_WEIGHT: Record<ServiceType, number> = {
  AKTE_KEMATIAN: 3,
  AKTE_KELAHIRAN: 2,
  KARTU_KELUARGA: 1,
};

const PRIORITY_LABEL: Record<number, string> = {
  3: "Mendesak",
  2: "Prioritas",
  1: "Normal",
};

const PRIORITY_BADGE_CLASS: Record<number, string> = {
  3: "bg-pastel-red text-pastel-red-ink",
  2: "bg-pastel-yellow text-pastel-yellow-ink",
  1: "bg-canvas text-ink-muted",
};

export function servicePriorityWeight(serviceType: ServiceType): number {
  return SERVICE_PRIORITY_WEIGHT[serviceType] ?? 1;
}

export function priorityLabel(weight: number): string {
  return PRIORITY_LABEL[weight] ?? "Normal";
}

export function priorityBadgeClass(weight: number): string {
  return PRIORITY_BADGE_CLASS[weight] ?? "bg-canvas text-ink-muted";
}

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

/** Samarkan nama pemohon untuk halaman lacak publik, mis. "Budi Santoso" -> "B**i S*****o". */
export function maskName(name: string): string {
  return name
    .split(" ")
    .map((word) => {
      if (word.length <= 2) return word[0] + "*".repeat(Math.max(0, word.length - 1));
      return word[0] + "*".repeat(word.length - 2) + word[word.length - 1];
    })
    .join(" ");
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
