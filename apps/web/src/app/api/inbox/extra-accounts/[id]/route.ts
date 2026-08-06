import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { deleteExtraAccount } from "@/lib/botClient";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  try {
    await deleteExtraAccount(Number(id));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "bot_unreachable" }, { status: 503 });
  }
}
