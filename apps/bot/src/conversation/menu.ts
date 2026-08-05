import type { ServiceType } from "@kelurahan/db";

interface MenuOption {
  key: string;
  label: string;
  keywords: string[];
}

/**
 * Kartu Keluarga bukan lagi pilihan langsung - pilih "1" di sini akan menampilkan
 * submenu KK_SUBMENU dulu (lihat handler.ts step AWAIT_KK_SUBTYPE), karena syarat KK
 * berbeda jauh tergantung keperluannya (barcode, pisah KK, atau tambah anggota).
 * `serviceType: null` menandai opsi itu perlu submenu, bukan langsung dipakai.
 */
export const SERVICE_MENU: (MenuOption & { serviceType: ServiceType | null })[] = [
  {
    key: "1",
    serviceType: null,
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

export const KK_SUBMENU: (MenuOption & { serviceType: ServiceType })[] = [
  {
    key: "1",
    serviceType: "KK_BARCODE",
    label: "KK Barcode",
    keywords: ["kk barcode", "barcode"],
  },
  {
    key: "2",
    serviceType: "KK_PISAH",
    label: "Pisah KK (Pasangan Baru Menikah)",
    keywords: ["pisah kk", "pisah", "pasangan baru menikah", "pasangan baru"],
  },
  {
    key: "3",
    serviceType: "KK_TAMBAH_ANGGOTA",
    label: "Tambah Anggota Keluarga (Anak)",
    keywords: ["tambah anggota", "tambah anak", "anggota keluarga", "anak baru"],
  },
];

// Label untuk ServiceType lama yang sudah tidak bisa dipilih lagi (KARTU_KELUARGA generik,
// sebelum dipecah jadi 3 sub-jenis) - tetap perlu supaya riwayat lama tampil benar.
const LEGACY_LABELS: Partial<Record<ServiceType, string>> = {
  KARTU_KELUARGA: "Kartu Keluarga (KK)",
};

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

export function kkSubmenuText(): string {
  const lines = KK_SUBMENU.map((s) => `${s.key}. ${s.label}`).join("\n");
  return (
    `Baik, untuk keperluan Kartu Keluarga yang mana?\n\n${lines}\n\n` +
    `Balas dengan angka, atau ketik *menu* untuk kembali ke menu utama.`
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

export function resolveKkSubmenuChoice(text: string) {
  const trimmed = text.trim();
  const exact = KK_SUBMENU.find((s) => s.key === trimmed);
  if (exact) return exact;

  const normalized = trimmed.toLowerCase();
  if (!normalized) return undefined;
  return KK_SUBMENU.find((s) => s.keywords.some((kw) => normalized.includes(kw)));
}

export function serviceLabel(serviceType: ServiceType): string {
  return (
    SERVICE_MENU.find((s) => s.serviceType === serviceType)?.label ??
    KK_SUBMENU.find((s) => s.serviceType === serviceType)?.label ??
    LEGACY_LABELS[serviceType] ??
    serviceType
  );
}
