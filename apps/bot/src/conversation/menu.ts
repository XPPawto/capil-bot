import type { ServiceType } from "@kelurahan/db";

export const SERVICE_MENU: { key: string; serviceType: ServiceType; label: string }[] = [
  { key: "1", serviceType: "KARTU_KELUARGA", label: "Kartu Keluarga (KK)" },
  { key: "2", serviceType: "AKTE_KEMATIAN", label: "Akte Kematian" },
  { key: "3", serviceType: "AKTE_KELAHIRAN", label: "Akte Kelahiran" },
];

export function mainMenuText(): string {
  const lines = SERVICE_MENU.map((s) => `${s.key}. ${s.label}`).join("\n");
  return (
    `Selamat datang di Layanan Administrasi Kelurahan.\n\n` +
    `Silakan pilih layanan yang ingin diajukan dengan membalas angka pilihan:\n${lines}\n\n` +
    `Ketik *batal* kapan saja untuk membatalkan, *menu* untuk kembali ke menu ini, ` +
      `atau *status* untuk cek status pengajuan yang sudah pernah dikirim.`
  );
}

export function resolveServiceChoice(text: string) {
  const trimmed = text.trim();
  return SERVICE_MENU.find((s) => s.key === trimmed);
}

export function serviceLabel(serviceType: ServiceType): string {
  return SERVICE_MENU.find((s) => s.serviceType === serviceType)?.label ?? serviceType;
}
