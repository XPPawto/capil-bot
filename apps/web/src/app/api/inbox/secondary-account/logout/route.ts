import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { logoutSecondaryAccount } from "@/lib/botClient";

export async function POST(): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  try {
    const res = await logoutSecondaryAccount();
    if (!res.ok) {
      return NextResponse.json({ error: "failed" }, { status: res.status });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "bot_unreachable" }, { status: 503 });
  }
}
