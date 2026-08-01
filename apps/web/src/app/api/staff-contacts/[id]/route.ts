import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { absoluteUrl } from "@/lib/absoluteUrl";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const contactId = Number(id);
  const form = await req.formData();
  const action = String(form.get("action") ?? "");

  const current = await prisma.staffContact.findUnique({ where: { id: contactId } });
  if (!current) {
    const url = absoluteUrl(req, "/petugas");
    url.searchParams.set("error", "Kontak tidak ditemukan.");
    return NextResponse.redirect(url, { status: 303 });
  }

  if (action === "toggle") {
    await prisma.staffContact.update({ where: { id: contactId }, data: { active: !current.active } });
  } else if (action === "delete") {
    await prisma.staffContact.delete({ where: { id: contactId } });
  }

  return NextResponse.redirect(absoluteUrl(req, "/petugas"), { status: 303 });
}
