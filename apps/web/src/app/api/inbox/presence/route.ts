import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { fetchPresenceFromBot } from "@/lib/botClient";

/**
 * Status online & "sedang mengetik..." untuk SATU percakapan - dipoll berkala oleh
 * InboxClient.tsx selagi thread terbuka, sama seperti polling pesan. Tidak ada penyimpanan
 * di sisi web sama sekali, murni proxy tipis ke cache in-memory bot (lihat
 * wa/presenceTracker.ts) - presence tidak relevan untuk audit ledger (sekilas, basi dalam
 * hitungan detik).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const waJid = req.nextUrl.searchParams.get("waJid");
  const channel = req.nextUrl.searchParams.get("channel") === "EXTRA" ? "EXTRA" : "SERVICE";
  const extraAccountIdParam = req.nextUrl.searchParams.get("extraAccountId");
  const extraAccountId = extraAccountIdParam ? Number(extraAccountIdParam) : undefined;
  if (!waJid) {
    return NextResponse.json({ error: "missing_wajid" }, { status: 400 });
  }

  const presence = await fetchPresenceFromBot(waJid, channel, extraAccountId);
  return NextResponse.json(presence ?? { status: null, lastSeen: null });
}
