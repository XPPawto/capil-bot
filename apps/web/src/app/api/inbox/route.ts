import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { getInboxConversations } from "@/lib/inbox";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const channel = req.nextUrl.searchParams.get("channel") === "SECONDARY" ? "SECONDARY" : "SERVICE";
  const conversations = await getInboxConversations(channel);
  return NextResponse.json({ conversations });
}
