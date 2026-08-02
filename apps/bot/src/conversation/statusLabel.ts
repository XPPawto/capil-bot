import type { RequestStatus } from "@kelurahan/db";

export const STATUS_LABEL: Record<RequestStatus, string> = {
  DICEK: "Dicek",
  DIPROSES: "Diproses",
  DITOLAK: "Ditolak",
  SELESAI: "Selesai",
};
