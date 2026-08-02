import { NextRequest, NextResponse } from "next/server";
import { verifyCredentials } from "@/lib/auth";
import { absoluteUrl } from "@/lib/absoluteUrl";
import { createSession, COOKIE_NAME, SESSION_TTL_SECONDS } from "@/lib/session";
import { logSuspiciousFields } from "@/lib/securityLog";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");

  await logSuspiciousFields("/api/auth/login", { username, password });

  const result = await verifyCredentials(username, password);
  if (!result.ok) {
    const url = absoluteUrl(req, "/login");
    url.searchParams.set("error", result.error);
    return NextResponse.redirect(url, { status: 303 });
  }

  const token = await createSession(result.admin.id);
  const res = NextResponse.redirect(absoluteUrl(req, "/"), { status: 303 });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
