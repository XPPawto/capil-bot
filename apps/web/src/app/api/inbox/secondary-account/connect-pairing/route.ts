import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { connectSecondaryPairing } from "@/lib/botClient";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => ({}));
  const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber : "";
  if (!phoneNumber) {
    return NextResponse.json({ error: "missing_phone_number" }, { status: 400 });
  }

  try {
    const res = await connectSecondaryPairing(phoneNumber);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ error: data.error ?? "failed" }, { status: res.status });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "bot_unreachable" }, { status: 503 });
  }
}
