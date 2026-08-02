import { createWorker } from "tesseract.js";
import { logger } from "../logger";

const NIK_REGEX = /\b\d{16}\b/;

export interface KtpOcrResult {
  nik?: string;
  rawText: string;
}

/**
 * OCR KTP best-effort: hasilnya cuma "petunjuk" buat petugas (mis. NIK yang terbaca),
 * BUKAN pengganti verifikasi manual. Kualitas foto warga sangat bervariasi (blur, miring,
 * silau) jadi kegagalan/ketidakakuratan itu wajar - karena itu fungsi ini selalu
 * menelan errornya sendiri (return null) dan TIDAK BOLEH dipakai untuk menolak berkas.
 */
export async function extractKtpData(filePath: string): Promise<KtpOcrResult | null> {
  try {
    const worker = await createWorker("ind");
    try {
      const { data } = await worker.recognize(filePath);
      const rawText = data.text ?? "";
      const nikMatch = rawText.match(NIK_REGEX);
      return { nik: nikMatch?.[0], rawText };
    } finally {
      await worker.terminate();
    }
  } catch (err) {
    logger.warn({ err, filePath }, "OCR KTP gagal, dilewati (tidak menghalangi penerimaan berkas)");
    return null;
  }
}
