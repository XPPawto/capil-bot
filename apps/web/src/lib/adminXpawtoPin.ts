import crypto from "crypto";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "./session";

/**
 * Gerbang tambahan KHUSUS /admin-xpawto, di atas sesi admin biasa yang sudah wajib login -
 * supaya sekalipun sesi admin browser seseorang ketebak/ditinggal terbuka, halaman
 * percakapan warga ini tidak langsung kebuka tanpa lolos PIN+TOTP dulu. Verifikasi PIN/TOTP-nya
 * sendiri (bandingkan ke hash/kunci di database, dengan lockout) ada di lib/accessControl.ts.
 *
 * Cookie-nya HMAC-signed dan SENGAJA:
 *  - diikat ke token sesi admin saat ini (COOKIE_NAME) - jadi begitu admin logout / login ulang
 *    (token sesi ganti), cookie PIN lama otomatis tidak berlaku, tidak bisa "dibawa" ke sesi lain.
 *  - punya kedaluwarsa tertanam (PIN_TTL) yang dibandingkan constant-time - bukan nilai statis
 *    global yang sama untuk semua admin selamanya seperti implementasi sebelumnya.
 *
 * SENGAJA tanpa maxAge/expires di cookie-nya (cookie sesi murni - hilang saat browser ditutup);
 * TTL di dalam value-nya jadi batas atas kedua, supaya tab yang dibiarkan terbuka berhari-hari
 * tetap minta PIN+TOTP lagi.
 */
export const PIN_COOKIE_NAME = "axp_pin_ok";
const PIN_TTL_MS = 8 * 60 * 60 * 1000;

function secret(): string {
  return process.env.SESSION_SECRET ?? process.env.BOT_CONTROL_SECRET ?? "dev-secret-change-me";
}

function sign(sessionToken: string, expiresAt: number): string {
  return crypto.createHmac("sha256", secret()).update(`${sessionToken}:${expiresAt}`).digest("hex");
}

export async function hasValidPinCookie(): Promise<boolean> {
  const store = await cookies();
  const raw = store.get(PIN_COOKIE_NAME)?.value;
  if (!raw) return false;

  const sep = raw.indexOf(".");
  if (sep < 0) return false;
  const expiresAt = Number(raw.slice(0, sep));
  const providedSig = raw.slice(sep + 1);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const sessionToken = store.get(COOKIE_NAME)?.value ?? "";
  const expectedSig = sign(sessionToken, expiresAt);
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function setPinCookie(): Promise<void> {
  const store = await cookies();
  const sessionToken = store.get(COOKIE_NAME)?.value ?? "";
  const expiresAt = Date.now() + PIN_TTL_MS;
  store.set(PIN_COOKIE_NAME, `${expiresAt}.${sign(sessionToken, expiresAt)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // tanpa maxAge - lihat komentar di atas.
  });
}
