import crypto from "crypto";

const MAX_CLOCK_SKEW_MS = 30_000;

/**
 * Kembaran persis dari signControlRequest di sisi web (dua proses terpisah, tidak ada
 * package bersama untuk crypto helper kecil ini - pola yang sama dipakai untuk
 * fileEncryption.ts di bot & web). HARUS identik byte-per-byte supaya signature cocok.
 */
function computeSignature(secret: string, timestamp: string, method: string, path: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}:${method}:${path}:${body}`).digest("hex");
}

/**
 * Verifikasi zero-trust: timestamp harus dalam jendela waktu wajar (anti replay - signature
 * lama yang disadap tidak bisa dipakai ulang setelah kedaluwarsa) dan signature harus cocok
 * persis lewat constant-time compare (anti timing attack saat membandingkan hash).
 */
export function verifyControlRequestSignature(
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  method: string,
  path: string,
  rawBody: string
): boolean {
  if (!timestamp || !signature) return false;

  const timestampNum = Number(timestamp);
  if (!Number.isFinite(timestampNum)) return false;
  if (Math.abs(Date.now() - timestampNum) > MAX_CLOCK_SKEW_MS) return false;

  const expected = computeSignature(secret, timestamp, method, path, rawBody);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
