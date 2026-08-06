import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { verifyAdminXpawtoPin, verifyAdminXpawtoTotp } from "@/lib/accessControl";
import { setPinCookie } from "@/lib/adminXpawtoPin";
import { logSuspiciousFields } from "@/lib/securityLog";

/**
 * Cuma boleh dipanggil oleh admin yang SUDAH login (requireAdmin biasa - gerbang PIN+TOTP di
 * sini SENDIRI belum lolos di titik ini, jadi tidak bisa pakai requireVerifiedAdmin yang
 * justru mensyaratkan itu, telur-ayam). Dua syarat berurutan: PIN dulu, baru TOTP - keduanya
 * WAJIB benar sebelum cookie "lolos" diset.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => ({}));
  const pin = typeof body?.pin === "string" ? body.pin : "";
  const totp = typeof body?.totp === "string" ? body.totp : "";

  const pinResult = await verifyAdminXpawtoPin(guard.admin.id, pin);
  if (!pinResult.ok) {
    await logSuspiciousFields("/api/inbox/verify-pin", { pin }).catch(() => undefined);
    return NextResponse.json({ error: pinResult.error ?? "invalid_pin" }, { status: 401 });
  }

  const totpResult = await verifyAdminXpawtoTotp(guard.admin.id, totp);
  if (!totpResult.ok) {
    return NextResponse.json({ error: totpResult.error ?? "invalid_code" }, { status: 401 });
  }

  await setPinCookie();
  return NextResponse.json({ ok: true });
}
