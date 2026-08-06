import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { getInboxConversations } from "@/lib/inbox";

export async function GET(): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const conversations = await getInboxConversations();
  return NextResponse.json({ conversations });
}
