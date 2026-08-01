import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { absoluteUrl } from "@/lib/absoluteUrl";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const form = await req.formData();
  const waNumber = String(form.get("waNumber") ?? "").replace(/\D/g, "");
  const label = String(form.get("label") ?? "").trim();

  if (!waNumber || waNumber.length < 8 || !label) {
    const url = absoluteUrl(req, "/petugas");
    url.searchParams.set("error", "Nomor WA dan label wajib diisi dengan benar.");
    return NextResponse.redirect(url, { status: 303 });
  }

  await prisma.staffContact.create({ data: { waNumber, label, active: true } });

  return NextResponse.redirect(absoluteUrl(req, "/petugas"), { status: 303 });
}
