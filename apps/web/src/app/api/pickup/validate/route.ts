import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { serviceLabel } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ valid: false, reason: "Kode QR kosong." }, { status: 400 });
  }

  const request = await prisma.request.findUnique({ where: { pickupToken: token } });
  if (!request) {
    return NextResponse.json({ valid: false, reason: "QR tidak dikenali." });
  }
  if (request.pickupTokenUsedAt) {
    return NextResponse.json({ valid: false, reason: "QR ini sudah pernah digunakan untuk pengambilan." });
  }
  if (request.status !== "DIPROSES") {
    return NextResponse.json({
      valid: false,
      reason: `Pengajuan ini berstatus ${request.status}, bukan sedang diproses.`,
    });
  }

  return NextResponse.json({
    valid: true,
    request: {
      id: request.id,
      ticketNumber: request.ticketNumber,
      applicantName: request.applicantName,
      serviceLabel: serviceLabel(request.serviceType),
      waNumber: request.waNumber,
    },
  });
}
