import type { NextRequest } from "next/server";

/**
 * Next.js's req.url/req.nextUrl tidak bisa dipercaya di belakang reverse proxy/tunnel
 * (mis. Cloudflare Tunnel) - selalu resolve ke origin internal server, bukan domain
 * publik yang sebenarnya diakses warga/admin. Selalu bangun URL absolut dari header
 * x-forwarded-host/x-forwarded-proto (fallback ke header host biasa) supaya redirect
 * tidak pernah mengarah ke "localhost".
 */
export function absoluteUrl(req: NextRequest, path: string): URL {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const protocol = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return new URL(path, `${protocol}://${host}`);
}
