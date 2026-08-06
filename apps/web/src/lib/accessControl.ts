import crypto from "crypto";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@kelurahan/db";
import type { Admin } from "@kelurahan/db";
import { getCurrentAdmin } from "./session";
import { verifyTotpCode } from "./totp";
import { hasValidPinCookie } from "./adminXpawtoPin";

/**
 * Gerbang keamanan tambahan KHUSUS /admin-xpawto (dan seluruh /api/inbox/* yang cuma
 * dipakai halaman itu) - di atas sesi admin biasa. Dua kredensial di sini SENGAJA tidak
 * pernah tersimpan sebagai teks polos di mana pun (bukan di kode, bukan di .env, bukan di
 * riwayat chat) - beda dari PIN lama yang sempat hardcoded di kode sumber:
 *  1. pinHash - hash satu arah (bcrypt), tidak bisa dibalik untuk tahu PIN aslinya lagi
 *     sekalipun basis data ini bocor.
 *  2. totpSecret - kunci bersama TOTP (RFC 6238, app authenticator/Kata Sandi iPhone),
 *     dienkripsi AES-256-GCM. Authentication tag GCM membuat isinya TIDAK BISA diubah/diganti
 *     sama sekali tanpa kunci yang cuma ada di environment variable server
 *     (ACCESS_CONTROL_KEY, tidak pernah masuk git).
 *
 * TIDAK ADA satu baris kode pun di aplikasi yang berjalan ini (route API, halaman, dsb)
 * yang bisa MENULIS ke tabel AccessControl - satu-satunya jalur tulis adalah script CLI
 * terpisah (packages/db/scripts/setAccessControl.ts) yang harus dijalankan manual langsung
 * di server.
 *
 * (Sempat ada lapisan IP allowlist di sini juga - dicabut karena IP HP/rumah terlalu sering
 * berubah, gampang bikin pemilik sendiri ikut terkunci. TOTP menggantikannya: tidak
 * bergantung jaringan sama sekali, dan tetap kuat karena kodenya basi tiap 30 detik.)
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getAccessControlKey(): Buffer {
  const raw = process.env.ACCESS_CONTROL_KEY;
  if (!raw) throw new Error("ACCESS_CONTROL_KEY belum diset di .env");
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) throw new Error("ACCESS_CONTROL_KEY harus 64 karakter hex (32 byte)");
  return key;
}

export function encryptSecret(plain: string): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getAccessControlKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

function decryptSecret(blob: Buffer): string {
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = blob.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, getAccessControlKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

type Guard = { admin: Admin } | { error: NextResponse };

/**
 * Dipakai sebagai pengganti requireAdmin() BIASA (dari lib/apiGuard.ts) di seluruh
 * /api/inbox/* - menambahkan syarat "sudah lolos PIN+TOTP" (cookie yang sama dipakai
 * halamannya) SEBELUM memproses apa pun, supaya endpoint JSON-nya tidak bisa dipanggil
 * langsung cuma bermodal sesi admin biasa, melewati gerbang PIN+TOTP di halamannya.
 */
export async function requireVerifiedAdmin(): Promise<Guard> {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (!(await hasValidPinCookie())) {
    return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }
  return { admin };
}

const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MINUTES = 15;

/**
 * Verifikasi PIN /admin-xpawto terhadap hash di database (bukan lagi dibandingkan ke nilai
 * polos manapun). Lockout per-admin, sama pola dengan verifyCredentials login biasa di
 * lib/auth.ts - supaya sesi admin yang valid tidak bisa dipakai untuk brute-force PIN 6
 * digit tanpa batas percobaan. Kunci yang sama juga menghitung percobaan TOTP salah (satu
 * lockout gabungan untuk seluruh gerbang PIN+TOTP, bukan dua penghitung terpisah).
 */
export async function verifyAdminXpawtoPin(adminId: number, input: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await prisma.admin.findUnique({ where: { id: adminId } });
  if (!admin) return { ok: false, error: "unauthorized" };

  if (admin.pinLockedUntil && admin.pinLockedUntil > new Date()) {
    const minutesLeft = Math.ceil((admin.pinLockedUntil.getTime() - Date.now()) / 60000);
    return { ok: false, error: `Terlalu banyak percobaan, coba lagi dalam ${minutesLeft} menit.` };
  }

  const record = await prisma.accessControl.findUnique({ where: { id: 1 } });
  if (!record) return { ok: false, error: "belum_disetup" };

  const valid = await bcrypt.compare(input, record.pinHash);
  if (!valid) {
    return failPin(adminId, admin.pinFailedCount);
  }
  return { ok: true };
}

/**
 * Verifikasi kode TOTP 6 digit - dipanggil SETELAH PIN benar (lihat verify-pin/route.ts),
 * jadi memakai counter percobaan gagal yang sama supaya orang yang lolos PIN tidak bisa lanjut
 * brute-force TOTP tanpa batas juga.
 */
export async function verifyAdminXpawtoTotp(adminId: number, code: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await prisma.admin.findUnique({ where: { id: adminId } });
  if (!admin) return { ok: false, error: "unauthorized" };

  const record = await prisma.accessControl.findUnique({ where: { id: 1 } });
  if (!record?.totpSecret) return { ok: false, error: "belum_disetup" };

  const secret = decryptSecret(Buffer.from(record.totpSecret));
  const valid = verifyTotpCode(secret, code);
  if (!valid) {
    return failPin(adminId, admin.pinFailedCount);
  }

  await prisma.admin.update({ where: { id: adminId }, data: { pinFailedCount: 0, pinLockedUntil: null } });
  return { ok: true };
}

async function failPin(adminId: number, currentCount: number): Promise<{ ok: false; error: string }> {
  const pinFailedCount = currentCount + 1;
  const pinLockedUntil =
    pinFailedCount >= PIN_MAX_ATTEMPTS ? new Date(Date.now() + PIN_LOCKOUT_MINUTES * 60 * 1000) : null;
  await prisma.admin.update({ where: { id: adminId }, data: { pinFailedCount, pinLockedUntil } });
  return { ok: false, error: "invalid_code" };
}
