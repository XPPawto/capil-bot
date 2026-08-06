import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { setPinCookie, verifyPin } from "@/lib/adminXpawtoPin";
import { logSuspiciousFields } from "@/lib/securityLog";

/**
 * Cuma boleh dipanggil oleh admin yang SUDAH login (requireAdmin) - PIN ini gerbang
 * TAMBAHAN, bukan pengganti sesi admin biasa.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => ({}));
  const pin = typeof body?.pin === "string" ? body.pin : "";

  if (!verifyPin(pin)) {
    await logSuspiciousFields("/api/inbox/verify-pin", { pin }).catch(() => undefined);
    return NextResponse.json({ error: "invalid_pin" }, { status: 401 });
  }

  await setPinCookie();
  return NextResponse.json({ ok: true });
}
