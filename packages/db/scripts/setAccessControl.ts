import crypto from "crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

/**
 * Satu-satunya cara mengisi/mengubah tabel AccessControl (PIN + kunci TOTP untuk
 * /admin-xpawto) - SENGAJA tidak ada rute API atau tombol UI mana pun di aplikasi yang bisa
 * melakukan ini. Harus dijalankan manual, langsung di server, oleh orang yang memang punya
 * akses shell ke situ - bukan sesuatu yang bisa dipicu lewat permintaan HTTP dari mana pun.
 *
 * Semua nilai rahasia diambil dari environment variable SAAT SCRIPT INI DIJALANKAN, tidak
 * ada satu pun yang ditulis di file ini - jadi file ini sendiri aman untuk ikut di-commit ke
 * git (isinya cuma logika, bukan data rahasia apa pun).
 *
 * Cara pakai (jalankan dari root repo, lewat npm workspace) - SET_PIN dan GENERATE_TOTP
 * sama-sama opsional (tapi minimal satu wajib), yang tidak disertakan dibiarkan apa adanya:
 *
 *   # Ganti PIN saja:
 *   ACCESS_CONTROL_KEY=<64 hex char> SET_PIN=<pin baru> \
 *     npm run set-access-control --workspace=@kelurahan/db
 *
 *   # Buat/ganti kunci TOTP (cetak otpauth:// URI + jalur file QR PNG ke stdout, TIDAK
 *   # pernah ke database log/riwayat - pindai/scan QR itu lewat app authenticator sekali,
 *   # lalu hapus file PNG-nya):
 *   ACCESS_CONTROL_KEY=<64 hex char> GENERATE_TOTP=1 TOTP_QR_OUT=/path/qr.png \
 *     npm run set-access-control --workspace=@kelurahan/db
 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function generateBase32Secret(byteLength = 20): string {
  const bytes = crypto.randomBytes(byteLength);
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

async function main(): Promise<void> {
  const pin = process.env.SET_PIN;
  const generateTotp = process.env.GENERATE_TOTP === "1";
  const totpQrOut = process.env.TOTP_QR_OUT;
  const keyHex = process.env.ACCESS_CONTROL_KEY;

  if (!pin && !generateTotp) {
    throw new Error("Isi minimal salah satu: SET_PIN atau GENERATE_TOTP=1.");
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.accessControl.findUnique({ where: { id: 1 } });
    if (!pin && !existing) {
      throw new Error("Belum ada baris AccessControl sama sekali - wajib isi SET_PIN untuk setup pertama kali.");
    }

    const pinHash = pin ? await bcrypt.hash(pin, 12) : existing!.pinHash;

    let totpSecretBlob: Buffer | undefined = existing?.totpSecret ? Buffer.from(existing.totpSecret) : undefined;
    let otpauthUri: string | undefined;

    if (generateTotp) {
      if (!keyHex) throw new Error("ACCESS_CONTROL_KEY wajib diisi untuk GENERATE_TOTP=1.");
      const key = Buffer.from(keyHex, "hex");
      if (key.length !== 32) {
        throw new Error("ACCESS_CONTROL_KEY harus 64 karakter hex (32 byte) - jalankan `openssl rand -hex 32` untuk buat yang baru.");
      }

      const secret = generateBase32Secret();
      otpauthUri = `otpauth://totp/AdminXpawto:owner?secret=${secret}&issuer=AdminXpawto&algorithm=SHA1&digits=6&period=30`;

      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
      const authTag = cipher.getAuthTag();
      totpSecretBlob = Buffer.concat([iv, authTag, encrypted]);

      if (totpQrOut) {
        const QRCode = (await import("qrcode")).default;
        await QRCode.toFile(totpQrOut, otpauthUri, { width: 360, margin: 2 });
      }
    }

    await prisma.accessControl.upsert({
      where: { id: 1 },
      create: { id: 1, pinHash, totpSecret: totpSecretBlob },
      update: { pinHash, ...(totpSecretBlob !== undefined ? { totpSecret: totpSecretBlob } : {}) },
    });

    // Sengaja TIDAK mencetak ulang PIN ke sini - konfirmasi cukup berupa status, bukan
    // nilainya, supaya tidak muncul di riwayat terminal/log proses yang menjalankan script
    // ini. otpauth:// URI DIKECUALIKAN dari larangan ini (dicetak apa adanya di bawah) -
    // nilai itu memang HARUS keluar dari script ini sekali supaya bisa dipindai ke HP,
    // pemanggil script yang bertanggung jawab tidak membiarkannya menempel di riwayat
    // terminal setelah dipakai.
    console.log(`AccessControl diperbarui. PIN: ${pin ? "diganti" : "tidak diubah"}.`);
    if (otpauthUri) {
      console.log(`TOTP baru dibuat. otpauth URI:\n${otpauthUri}`);
      if (totpQrOut) console.log(`QR disimpan ke: ${totpQrOut}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Gagal memperbarui AccessControl:", err.message ?? err);
  process.exit(1);
});
