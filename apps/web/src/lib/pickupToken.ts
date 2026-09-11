import crypto from "crypto";

// Alfabet sama persis dengan sisi bot (media/finalize.ts) - tanpa huruf/angka yang mudah
// tertukar saat dibacakan (0/O, 1/I). 32 karakter -> 256 % 32 == 0, jadi pemetaan byte acak
// ke indeks alfabet TIDAK punya modulo bias sama sekali (tiap karakter sama kemungkinannya).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Token QR pengambilan (dipakai scan di loket). Digenerate di sini saat transisi status ke
 * DIPROSES (lihat api/requests/[id]/status) - bukan lagi di sendStatusMessage sisi bot, yang
 * bisa dipanggil ulang oleh reconciler dan dulu meregenerasi token tiap retry sehingga QR
 * yang sudah diterima warga bisa mendadak tidak berlaku.
 */
export function generatePickupToken(length = 10): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
