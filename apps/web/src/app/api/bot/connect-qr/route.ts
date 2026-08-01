import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { connectBotQr } from "@/lib/botClient";

export async function POST(): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  try {
    const res = await connectBotQr();
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ error: data.error ?? "failed" }, { status: res.status });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "bot_unreachable" }, { status: 503 });
  }
}
