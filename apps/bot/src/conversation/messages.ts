import { config } from "../config";

export const MESSAGES = {
  invalidName: "Nama tidak valid, mohon ketik nama lengkap (minimal 3 karakter).",
  cancelled: "Pengajuan dibatalkan. Ketik *menu* untuk memulai pengajuan baru.",
  unrecognized:
    "Maaf, perintah tidak dikenali. Ketik *menu* untuk melihat pilihan layanan, atau *status* untuk cek status pengajuan.",
  noRequirementsConfigured:
    "Mohon maaf, syarat untuk layanan ini belum tersedia. Silakan hubungi petugas kelurahan.",
  waitingForDocInsteadOfText: (nextName: string) =>
    `Mohon kirim file (foto atau PDF) untuk syarat: *${nextName}*.\nKetik *batal* untuk membatalkan pengajuan.`,
  progress: (doneCount: number, total: number, nextName?: string) => {
    if (!nextName) return `Semua syarat (${doneCount}/${total}) telah diterima, sedang diproses...`;
    return `Syarat diterima (${doneCount}/${total}).\nSelanjutnya, mohon kirim: *${nextName}*`;
  },
  submitted: (ticketNumber: string, trackingToken: string) =>
    `Semua syarat sudah lengkap.\nNomor tiket Anda: *${ticketNumber}*\n(catat/screenshot nomor ini sebagai referensi)\n\n` +
    `Data Anda sedang *dicek* oleh petugas. Anda akan menerima notifikasi begitu ada perkembangan, ` +
    `atau ketik *status* kapan saja untuk cek sendiri.\n\n` +
    `Lacak status pengajuan lewat browser (link ini pribadi, jangan dibagikan ke orang lain): ` +
    `${config.publicWebUrl}/track/${trackingToken}`,
  ratingThanks: (rating: number) =>
    `Terima kasih atas penilaian Anda (${rating}/5)! Masukan Anda membantu kami meningkatkan layanan.`,
};

/**
 * Ditampilkan begitu layanan (atau sub-jenis KK) dipilih, SEBELUM nama pemohon ditanya -
 * supaya warga tahu dulu apa saja yang perlu disiapkan sebelum "berkomitmen" mengetik nama.
 * Kalau ternyata belum siap, tinggal ketik *batal* di sini tanpa harus mengetik nama dulu.
 */
export function serviceSelectedText(serviceLabelText: string, requirementsList: string): string {
  return (
    `Anda memilih: *${serviceLabelText}*.\n\nBerikut syarat yang perlu disiapkan:\n${requirementsList}\n\n` +
    `Kalau sudah siap semua, silakan ketik nama lengkap pemohon untuk memulai pengiriman berkas. ` +
    `Belum siap? Ketik *batal*, dan kembali kapan saja lewat *menu*.`
  );
}

export function startCollectingText(firstRequirementName: string): string {
  return `Baik. Silakan kirim file (foto atau PDF, maks 10MB) untuk syarat pertama:\n*${firstRequirementName}*`;
}

/** Ditampilkan begitu semua syarat sudah terkumpul, SEBELUM benar-benar dikirim ke petugas -
 * warga bisa cek ulang & ganti salah satu file dulu kalau perlu, bukan langsung terkirim. */
export function reviewCompleteText(statusList: string): string {
  return (
    `Semua syarat sudah lengkap:\n${statusList}\n\n` +
    `Cek dulu, sudah benar semua? Ketik *lanjut* untuk mengirim pengajuan ini, atau ketik nomor syarat ` +
    `yang ingin diganti dulu sebelum dikirim.`
  );
}
