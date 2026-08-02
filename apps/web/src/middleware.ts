import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "kb_session";

/**
 * Guard cepat berbasis keberadaan cookie saja (middleware jalan di Edge runtime,
 * tidak bisa query Prisma/MySQL). Validasi sesi yang sesungguhnya (cek tabel Session
 * + expiry) dilakukan di getCurrentAdmin() pada layout dashboard & tiap API route.
 */
export function middleware(req: NextRequest) {
  const hasCookie = req.cookies.has(COOKIE_NAME);
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/track/")) {
    return NextResponse.next();
  }

  if (!hasCookie && pathname !== "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (hasCookie && pathname === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
