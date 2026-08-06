import fs from "fs";
import path from "path";
import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { decryptBuffer } from "@/lib/fileEncryption";
import { verifyLedgerChain, crossCheckLiveState } from "@kelurahan/db";

const UPLOAD_DIR = path.resolve(process.cwd(), "../..", process.env.UPLOAD_DIR ?? "./storage/uploads");

/**
 * Jalankan verifikasi penuh riwayat "Pesan Masuk" - dipakai badge/tombol "Terverifikasi" di
 * halaman /admin-xpawto. Tiga lapis pemeriksaan, urut dari yang paling murah ke paling mahal:
 *  1. Rantai hash ledger sendiri utuh (tidak ada entri yang diubah/dihapus/dicabang).
 *  2. Isi InboxMessage saat ini (teks, editedAt, status) cocok dengan yang seharusnya menurut
 *     ledger - mendeteksi perubahan langsung ke tabel yang melewati ledger sama sekali.
 *  3. Isi FILE lampiran di disk (didekripsi lalu di-hash ulang) cocok dengan sidik jari yang
 *     direkam ledger saat file itu pertama diterima - mendeteksi file yang ditukar diam-diam
 *     tanpa mengubah baris database sama sekali.
 * Lihat @kelurahan/db/auditLedger.ts untuk keterbatasan (riwayat sebelum ledger aktif
 * di-backfill, bukan bukti retroaktif ke sebelum backfill itu sendiri).
 */
export async function GET(): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const chain = await verifyLedgerChain();
  const { mismatches, attachmentChecks } = await crossCheckLiveState();

  const fileMismatches: { inboxMessageId: number; reason: string }[] = [];
  for (const check of attachmentChecks) {
    try {
      const absolutePath = path.resolve(UPLOAD_DIR, check.attachmentPath);
      if (!absolutePath.startsWith(UPLOAD_DIR + path.sep)) {
        fileMismatches.push({ inboxMessageId: check.inboxMessageId, reason: "jalur berkas mencurigakan" });
        continue;
      }
      const rawBuffer = await fs.promises.readFile(absolutePath);
      const plainBuffer = decryptBuffer(rawBuffer);
      const actualSha256 = crypto.createHash("sha256").update(plainBuffer).digest("hex");
      if (actualSha256 !== check.expectedSha256) {
        fileMismatches.push({ inboxMessageId: check.inboxMessageId, reason: "isi berkas di disk sudah berubah dari saat pertama diterima" });
      }
    } catch {
      fileMismatches.push({ inboxMessageId: check.inboxMessageId, reason: "berkas hilang atau gagal didekripsi" });
    }
  }

  const ok = chain.ok && mismatches.length === 0 && fileMismatches.length === 0;

  return NextResponse.json({
    ok,
    checkedAt: new Date().toISOString(),
    chain,
    rowMismatches: mismatches,
    fileMismatches,
    attachmentsChecked: attachmentChecks.length,
  });
}
