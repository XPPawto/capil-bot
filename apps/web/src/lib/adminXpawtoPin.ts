import crypto from "crypto";
import { cookies } from "next/headers";

/**
 * Gerbang tambahan KHUSUS /admin-xpawto, di atas sesi admin biasa yang sudah wajib login -
 * supaya sekalipun sesi admin browser seseorang ketebak/ditinggal terbuka, halaman
 * percakapan warga ini tidak langsung kebuka tanpa lolos PIN+TOTP dulu. Cookie-nya
 * HMAC-signed (bukan cuma "true" polos) supaya tidak bisa dipalsukan dengan menebak/menyetel
 * cookie sembarangan dari console browser. Verifikasi PIN/TOTP-nya sendiri (bandingkan ke
 * hash/kunci di database, dengan lockout) ada di lib/accessControl.ts.
 *
 * SENGAJA tanpa maxAge/expires - cookie sesi murni (bukan persisten). Begitu browser
 * benar-benar ditutup (bukan cuma pindah tab atau navigasi ke halaman lain lalu balik lagi -
 * itu tetap dianggap sesi yang sama), cookie ini hilang dan PIN+TOTP wajib dimasukkan ulang
 * lain kali /admin-xpawto dibuka - tidak nyantol berjam-jam seperti sebelumnya.
 */
export const PIN_COOKIE_NAME = "axp_pin_ok";

function secret(): string {
  return process.env.SESSION_SECRET ?? process.env.BOT_CONTROL_SECRET ?? "dev-secret-change-me";
}

function signedValue(): string {
  return crypto.createHmac("sha256", secret()).update("admin-xpawto-pin-ok").digest("hex");
}

export async function hasValidPinCookie(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(PIN_COOKIE_NAME)?.value;
  return value === signedValue();
}

export async function setPinCookie(): Promise<void> {
  const store = await cookies();
  store.set(PIN_COOKIE_NAME, signedValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // tanpa maxAge - lihat komentar di atas.
  });
}
