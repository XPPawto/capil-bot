import { NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { connectExtraAccountQr } from "@/lib/botClient";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  try {
    const res = await connectExtraAccountQr(Number(id));
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ error: data.error ?? "failed" }, { status: res.status });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "bot_unreachable" }, { status: 503 });
  }
}
