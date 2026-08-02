import { config } from "../config";

export const MESSAGES = {
  askName: "Baik, silakan ketik nama lengkap pemohon.",
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

export function startCollectingText(requirementsList: string, firstRequirementName: string): string {
  return (
    `Berikut daftar syarat yang perlu disiapkan:\n${requirementsList}\n\n` +
    `Silakan kirim file (foto atau PDF, maks 10MB) satu per satu, dimulai dari:\n*${firstRequirementName}*`
  );
}
