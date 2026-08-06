import { NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { getExtraAccountStatus } from "@/lib/botClient";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  try {
    const status = await getExtraAccountStatus(Number(id));
    return NextResponse.json(status);
  } catch {
    return NextResponse.json({
      id: Number(id),
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
