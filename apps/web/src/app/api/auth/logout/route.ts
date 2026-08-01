import { NextRequest, NextResponse } from "next/server";
import { absoluteUrl } from "@/lib/absoluteUrl";
import { destroyCurrentSession, COOKIE_NAME } from "@/lib/session";

export async function POST(req: NextRequest): Promise<NextResponse> {
  await destroyCurrentSession();
  const res = NextResponse.redirect(absoluteUrl(req, "/login"), { status: 303 });
  res.cookies.delete(COOKIE_NAME);
  return res;
}
