import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { absoluteUrl } from "@/lib/absoluteUrl";
import { prisma } from "@/lib/prisma";
import { invalidateRequirementsCache } from "@/lib/redis";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const requirementId = Number(id);
  const form = await req.formData();
  const action = String(form.get("action") ?? "");

  const current = await prisma.requirementTemplate.findUnique({ where: { id: requirementId } });
  if (!current) {
    const url = absoluteUrl(req, "/syarat");
    url.searchParams.set("error", "Syarat tidak ditemukan.");
    return NextResponse.redirect(url, { status: 303 });
  }

  if (action === "toggle") {
    await prisma.requirementTemplate.update({
      where: { id: requirementId },
      data: { active: !current.active },
    });
  } else if (action === "toggle-ocr") {
    await prisma.requirementTemplate.update({
      where: { id: requirementId },
      data: { ocrKtp: !current.ocrKtp },
    });
  } else if (action === "delete") {
    await prisma.requirementTemplate.delete({ where: { id: requirementId } });
  } else if (action === "move") {
    const direction = String(form.get("direction") ?? "");
    const neighbor = await prisma.requirementTemplate.findFirst({
      where: {
        serviceType: current.serviceType,
        order: direction === "up" ? { lt: current.order } : { gt: current.order },
      },
      orderBy: { order: direction === "up" ? "desc" : "asc" },
    });
    if (neighbor) {
      await prisma.$transaction([
        prisma.requirementTemplate.update({ where: { id: current.id }, data: { order: neighbor.order } }),
        prisma.requirementTemplate.update({ where: { id: neighbor.id }, data: { order: current.order } }),
      ]);
    }
  }

  await invalidateRequirementsCache(current.serviceType);

  return NextResponse.redirect(absoluteUrl(req, "/syarat"), { status: 303 });
}
