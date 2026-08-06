import crypto from "crypto";

/**
 * Implementasi TOTP (RFC 6238, dibangun di atas HOTP RFC 4226) dari nol pakai modul crypto
 * bawaan Node - sengaja tidak menambah dependency pihak ketiga untuk sesuatu sesensitif ini
 * (makin sedikit kode orang lain yang dipercaya, makin kecil permukaan serangannya). Standar
 * ini persis yang dipakai Google Authenticator, Authy, 1Password, maupun fitur bawaan "Kode
 * Verifikasi" di app Kata Sandi iPhone - jadi QR yang dibuat lewat modul ini bisa discan
 * app/fitur mana pun yang mendukung TOTP standar, tidak terikat satu aplikasi tertentu.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateBase32Secret(byteLength = 20): string {
  const bytes = crypto.randomBytes(byteLength);
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of clean) {
    const val = BASE32_ALPHABET.indexOf(ch);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/** HOTP (RFC 4226) - satu kode untuk satu nilai counter tertentu. */
function hotp(secret: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  // Counter TOTP tidak akan pernah realistis melebihi batas 32-bit (butuh ~2800 tahun pada
  // step 30 detik), jadi 4 byte tinggi selalu nol - writeBigUInt64BE tetap dipakai supaya
  // benar sesuai spesifikasi (counter 8 byte big-endian).
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** DIGITS).padStart(DIGITS, "0");
}

function currentCounter(stepOffset = 0): number {
  return Math.floor(Date.now() / 1000 / STEP_SECONDS) + stepOffset;
}

/**
 * Cocokkan kode 6 digit yang diketik user terhadap kode yang seharusnya aktif SAAT INI, plus
 * toleransi ±1 step (30 detik sebelum/sesudah) - jam HP dan server tidak pernah presisi
 * identik, tanpa toleransi ini kode yang sebenarnya benar bisa ditolak gara-gara selisih
 * beberapa detik saja.
 */
export function verifyTotpCode(base32Secret: string, code: string): boolean {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) return false;
  const secret = base32Decode(base32Secret);
  for (const offset of [0, -1, 1]) {
    const expected = hotp(secret, currentCounter(offset));
    const a = Buffer.from(expected);
    const b = Buffer.from(trimmed);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** URI standar `otpauth://` - dibaca lewat QR oleh app/fitur authenticator mana pun. */
export function buildOtpAuthUri(base32Secret: string, label: string, issuer: string): string {
  const encodedLabel = encodeURIComponent(`${issuer}:${label}`);
  const encodedIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${encodedLabel}?secret=${base32Secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
