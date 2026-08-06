import crypto from "crypto";
import { cookies } from "next/headers";

/**
 * Gerbang tambahan KHUSUS /admin-xpawto, di atas sesi admin biasa yang sudah wajib login -
 * supaya sekalipun sesi admin browser seseorang ketebak/ditinggal terbuka, halaman
 * percakapan warga ini tidak langsung kebuka tanpa tahu PIN-nya. Cookie-nya HMAC-signed
 * (bukan cuma "true" polos) supaya tidak bisa dipalsukan dengan menebak/menyetel cookie
 * sembarangan dari console browser.
 */
export const PIN_COOKIE_NAME = "axp_pin_ok";
const PIN = process.env.ADMIN_XPAWTO_PIN ?? "171125";
const PIN_TTL_SECONDS = 12 * 60 * 60;

function secret(): string {
  return process.env.SESSION_SECRET ?? process.env.BOT_CONTROL_SECRET ?? "dev-secret-change-me";
}

function signedValue(): string {
  return crypto.createHmac("sha256", secret()).update("admin-xpawto-pin-ok").digest("hex");
}

export function verifyPin(input: string): boolean {
  // Perbandingan waktu-konstan - PIN cuma 6 digit jadi brute force tetap gampang kalau
  // mau, tapi tidak ada alasan membuka celah timing-attack yang gratis untuk dihindari.
  const a = Buffer.from(input);
  const b = Buffer.from(PIN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
    maxAge: PIN_TTL_SECONDS,
  });
}
