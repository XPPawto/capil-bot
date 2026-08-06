import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { getSecondaryAccountStatus } from "@/lib/botClient";

export async function GET(): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  try {
    const status = await getSecondaryAccountStatus();
    return NextResponse.json(status);
  } catch {
    return NextResponse.json({
      connected: false,
      isConnecting: false,
      waJid: null,
      phoneNumber: null,
      lastConnectedAt: null,
      qrDataUrl: null,
      pairingCode: null,
      offline: true,
    });
  }
}
