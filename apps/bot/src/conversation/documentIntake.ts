import fs from "fs";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { downloadAndValidate } from "../media/download";
import { extractKtpData } from "../media/ocr";
import { watermarkDocumentImage } from "../media/watermark";
import type { UploadedDocDraft } from "./types";

/**
 * Logika terima satu berkas syarat (download+validasi, OCR kalau syaratnya ditandai
 * ocrKtp, watermark untuk semua gambar) - dipakai bareng oleh COLLECTING_DOCS (alur
 * pengajuan baru) dan FIXING_REJECTED (alur perbaiki pengajuan ditolak), supaya kedua
 * alur itu konsisten tanpa duplikasi kode.
 */
export async function intakeDocument(
  sock: WASocket,
  msg: WAMessage,
  waJid: string,
  requirementId: number,
  requirementName: string,
  ocrKtp: boolean,
  serviceLabelText: string
): Promise<UploadedDocDraft> {
  const downloaded = await downloadAndValidate(sock, msg, waJid);
  let ocrNik: string | undefined;
  let ocrRawText: string | undefined;

  if (downloaded.mimeType.startsWith("image/")) {
    if (ocrKtp) {
      // OCR dulu di atas foto asli (belum ada watermark) supaya akurasi baca NIK tidak
      // terganggu, baru watermark ditumpuk sebelum file ini disimpan permanen.
      const ocrResult = await extractKtpData(downloaded.tempFilePath);
      ocrNik = ocrResult?.nik;
      ocrRawText = ocrResult?.rawText;
    }

    // Watermark diterapkan ke SEMUA syarat berupa gambar (bukan cuma yang ocrKtp) - KK,
    // buku nikah, dsb sama-sama memuat data pribadi yang berisiko kalau bocor.
    const original = await fs.promises.readFile(downloaded.tempFilePath);
    const watermarked = await watermarkDocumentImage(original, serviceLabelText);
    await fs.promises.writeFile(downloaded.tempFilePath, watermarked);
  }

  return {
    requirementId,
    requirementName,
    tempFilePath: downloaded.tempFilePath,
    fileName: downloaded.fileName,
    mimeType: downloaded.mimeType,
    ocrNik,
    ocrRawText,
  };
}
