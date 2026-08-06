import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { getInboxConversations } from "@/lib/inbox";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const channel = req.nextUrl.searchParams.get("channel") === "EXTRA" ? "EXTRA" : "SERVICE";
  const extraAccountIdParam = req.nextUrl.searchParams.get("extraAccountId");
  const extraAccountId = extraAccountIdParam ? Number(extraAccountIdParam) : undefined;
  const conversations = await getInboxConversations(channel, extraAccountId);
  return NextResponse.json({ conversations });
}
