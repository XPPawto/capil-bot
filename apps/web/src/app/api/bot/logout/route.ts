import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { logoutBot } from "@/lib/botClient";

export async function POST(): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  try {
    await logoutBot();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "bot_unreachable" }, { status: 503 });
  }
}
