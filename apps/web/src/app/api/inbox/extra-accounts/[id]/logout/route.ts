import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { logoutExtraAccount } from "@/lib/botClient";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  try {
    const res = await logoutExtraAccount(Number(id));
    if (!res.ok) {
      return NextResponse.json({ error: "failed" }, { status: res.status });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "bot_unreachable" }, { status: 503 });
  }
}
