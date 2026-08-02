import crypto from "crypto";

/**
 * Signature HMAC-SHA256 dari (timestamp + method + path + body) pakai shared secret
 * sebagai key. Zero-trust: secret aslinya TIDAK PERNAH ikut lewat jaringan (beda dari
 * header rahasia statis sebelumnya) - kalau lalu lintas localhost disadap, penyerang
 * cuma dapat satu signature yang terikat ke payload & waktu tertentu, tidak bisa dipakai
 * untuk memalsukan perintah lain atau diputar ulang di luar jendela waktu yang diizinkan.
 */
export function signControlRequest(secret: string, timestamp: string, method: string, path: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}:${method}:${path}:${body}`).digest("hex");
}
