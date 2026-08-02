import { NextRequest, NextResponse } from "next/server";
import type { ServiceType } from "@kelurahan/db";
import { requireAdmin } from "@/lib/apiGuard";
import { absoluteUrl } from "@/lib/absoluteUrl";
import { prisma } from "@/lib/prisma";
import { invalidateRequirementsCache } from "@/lib/redis";

const VALID_SERVICE_TYPES: ServiceType[] = ["KARTU_KELUARGA", "AKTE_KEMATIAN", "AKTE_KELAHIRAN"];

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const form = await req.formData();
  const serviceType = String(form.get("serviceType") ?? "") as ServiceType;
  const name = String(form.get("name") ?? "").trim();
  const ocrKtp = form.get("ocrKtp") === "on";

  if (!VALID_SERVICE_TYPES.includes(serviceType) || !name) {
    const url = absoluteUrl(req, "/syarat");
    url.searchParams.set("error", "Data syarat tidak lengkap.");
    return NextResponse.redirect(url, { status: 303 });
  }

  const maxOrder = await prisma.requirementTemplate.aggregate({
    where: { serviceType },
    _max: { order: true },
  });

  await prisma.requirementTemplate.create({
    data: { serviceType, name, order: (maxOrder._max.order ?? 0) + 1, active: true, ocrKtp },
  });
  await invalidateRequirementsCache(serviceType);

  return NextResponse.redirect(absoluteUrl(req, "/syarat"), { status: 303 });
}
