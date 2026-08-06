import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { createExtraAccount, listExtraAccounts } from "@/lib/botClient";

export async function GET(): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  try {
    const accounts = await listExtraAccounts();
    return NextResponse.json({ accounts });
  } catch {
    return NextResponse.json({ accounts: [], offline: true });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => ({}));
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label) {
    return NextResponse.json({ error: "missing_label" }, { status: 400 });
  }

  const account = await createExtraAccount(label);
  if (!account) {
    return NextResponse.json({ error: "bot_unreachable" }, { status: 503 });
  }
  return NextResponse.json(account);
}
