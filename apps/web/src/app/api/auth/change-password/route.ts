import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { changePassword } from "@/lib/auth";
import { requireAdmin } from "@/lib/apiGuard";
import { absoluteUrl } from "@/lib/absoluteUrl";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const form = await req.formData();
  const currentPassword = String(form.get("currentPassword") ?? "");
  const newPassword = String(form.get("newPassword") ?? "");

  if (newPassword.length < 8) {
    const url = absoluteUrl(req, "/akun");
    url.searchParams.set("error", "Password baru minimal 8 karakter.");
    return NextResponse.redirect(url, { status: 303 });
  }

  const admin = await prisma.admin.findUnique({ where: { id: guard.admin.id } });
  const valid = admin && (await bcrypt.compare(currentPassword, admin.passwordHash));
  if (!valid) {
    const url = absoluteUrl(req, "/akun");
    url.searchParams.set("error", "Password saat ini salah.");
    return NextResponse.redirect(url, { status: 303 });
  }

  await changePassword(guard.admin.id, newPassword);
  const url = absoluteUrl(req, "/akun");
  url.searchParams.set("success", "1");
  return NextResponse.redirect(url, { status: 303 });
}
