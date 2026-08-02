/**
 * Deteksi tipe file dari "magic bytes" (signature byte pertama isi file), BUKAN dari
 * ekstensi nama file atau mimetype yang diklaim pengirim. Pertahanan terhadap file
 * masquerading: peretas yang mengganti ekstensi file berbahaya (.exe/.js/dsb) jadi
 * "foto_ktp.jpg" akan lolos kalau sistem cuma percaya klaim mimetype dari WhatsApp -
 * signature byte asli isi filenya tidak bisa dipalsukan semudah itu.
 */
const SIGNATURES: { mime: "image/jpeg" | "image/png" | "application/pdf"; matches: (buf: Buffer) => boolean }[] = [
  {
    mime: "image/jpeg",
    matches: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  {
    mime: "image/png",
    matches: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a,
  },
  {
    mime: "application/pdf",
    matches: (buf) => buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-",
  },
];

/** Mengembalikan mimetype asli berdasarkan isi file, atau null kalau tidak cocok satupun signature yang dikenal. */
export function detectRealMimeType(buffer: Buffer): string | null {
  return SIGNATURES.find((sig) => sig.matches(buffer))?.mime ?? null;
}
