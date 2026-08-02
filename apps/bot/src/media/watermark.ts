import sharp from "sharp";
import { config } from "../config";
import { logger } from "../logger";

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function watermarkSvg(width: number, height: number, text: string): Buffer {
  const fontSize = Math.max(16, Math.round(width / 22));
  const line1 = escapeXml(text);
  const line2 = escapeXml("HANYA UNTUK KEPERLUAN INI - BUKAN UNTUK PINJAMAN ONLINE");
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(${width / 2}, ${height / 2}) rotate(-30)" text-anchor="middle"
         font-family="sans-serif" fill="rgba(255,0,0,0.38)" stroke="rgba(255,255,255,0.25)" stroke-width="1">
        <text y="-${fontSize * 0.6}" font-size="${fontSize}" font-weight="bold">${line1}</text>
        <text y="${fontSize * 1.2}" font-size="${Math.round(fontSize * 0.7)}" font-weight="bold">${line2}</text>
      </g>
    </svg>`;
  return Buffer.from(svg);
}

/**
 * Menumpuk teks watermark transparan di atas foto berkas syarat warga (KTP, KK, buku nikah,
 * dll) sebelum disimpan permanen, supaya kalau berkas ini bocor/disalahgunakan (mis. untuk
 * pengajuan pinjaman online oleh oknum), jelas kelihatan itu cuma untuk keperluan pengajuan
 * dokumen kelurahan. Berlaku untuk SEMUA syarat berupa gambar, bukan cuma yang ditandai
 * ocrKtp - hampir semua berkas ini (KTP, KK, buku nikah) memuat data pribadi yang berisiko
 * sama kalau bocor. Best-effort: kalau gagal (format aneh, dsb), file asli tetap dipakai apa
 * adanya - jangan sampai warga gagal mengajukan berkas hanya gara-gara watermark error.
 */
export async function watermarkDocumentImage(buffer: Buffer, serviceLabel: string): Promise<Buffer> {
  try {
    // .rotate() tanpa argumen: auto-orientasi berdasarkan tag EXIF Orientation sebelum
    // metadata-nya sendiri dibuang (sharp tidak menyalin metadata ke output kecuali
    // .withMetadata() dipanggil) - jadi watermark ini sekaligus menghapus EXIF (GPS, dsb).
    const image = sharp(buffer).rotate();
    const metadata = await image.metadata();
    // metadata() selalu melaporkan dimensi ASLI (sebelum auto-rotate); untuk orientation
    // EXIF 5-8 (rotasi 90/270 derajat), pixel akhir setelah .rotate() sudah tertukar
    // width/height-nya - kalau tidak disesuaikan, ukuran overlay SVG akan salah/terpotong.
    const isSwapped = (metadata.orientation ?? 1) >= 5;
    const width = (isSwapped ? metadata.height : metadata.width) ?? 1000;
    const height = (isSwapped ? metadata.width : metadata.height) ?? 700;

    const dateStr = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date());
    const text = `HANYA UNTUK PENGAJUAN ${serviceLabel.toUpperCase()} - ${config.kelurahanName.toUpperCase()} - ${dateStr}`;
    const overlay = watermarkSvg(width, height, text);

    return await image.composite([{ input: overlay, top: 0, left: 0 }]).toBuffer();
  } catch (err) {
    logger.warn({ err }, "Gagal menambahkan watermark, file asli dipakai apa adanya");
    return buffer;
  }
}
