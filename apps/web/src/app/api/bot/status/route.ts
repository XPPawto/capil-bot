import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { getBotStatus } from "@/lib/botClient";

export async function GET(): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  try {
    const status = await getBotStatus();
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
