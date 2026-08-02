import type { ServiceType } from "@kelurahan/db";

export const SERVICE_MENU: { key: string; serviceType: ServiceType; label: string; keywords: string[] }[] = [
  {
    key: "1",
    serviceType: "KARTU_KELUARGA",
    label: "Kartu Keluarga (KK)",
    keywords: ["kk", "kartu keluarga"],
  },
  {
    key: "2",
    serviceType: "AKTE_KEMATIAN",
    label: "Akte Kematian",
    keywords: ["akte kematian", "akta kematian", "surat kematian", "kematian", "meninggal"],
  },
  {
    key: "3",
    serviceType: "AKTE_KELAHIRAN",
    label: "Akte Kelahiran",
    keywords: ["akte kelahiran", "akta kelahiran", "surat kelahiran", "kelahiran", "lahir"],
  },
];

export function mainMenuText(): string {
  const lines = SERVICE_MENU.map((s) => `${s.key}. ${s.label}`).join("\n");
  return (
    `Selamat datang di Layanan Administrasi Kelurahan.\n\n` +
    `Silakan pilih layanan yang ingin diajukan - balas dengan angka, atau langsung ketik nama layanannya ` +
      `(mis. "kartu keluarga" atau "akte lahir"):\n${lines}\n\n` +
    `Ketik *batal* kapan saja untuk membatalkan, *menu* untuk kembali ke menu ini, ` +
      `atau *status* untuk cek status pengajuan yang sudah pernah dikirim.`
  );
}

/**
 * Terima angka pilihan (jalur cepat) ATAU kata kunci natural (mis. "mau bikin akte lahir")
 * supaya warga yang tidak terbiasa mengetik perintah tetap bisa langsung dikenali botnya -
 * WhatsApp tidak lagi mengizinkan tombol/list interaktif asli untuk akun non-Business, jadi
 * ini jalan paling andal untuk bikin interaksi terasa tidak kaku.
 */
export function resolveServiceChoice(text: string) {
  const trimmed = text.trim();
  const exact = SERVICE_MENU.find((s) => s.key === trimmed);
  if (exact) return exact;

  const normalized = trimmed.toLowerCase();
  if (!normalized) return undefined;
  return SERVICE_MENU.find((s) => s.keywords.some((kw) => normalized.includes(kw)));
}

export function serviceLabel(serviceType: ServiceType): string {
  return SERVICE_MENU.find((s) => s.serviceType === serviceType)?.label ?? serviceType;
}
