import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { serviceLabel } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const since = req.nextUrl.searchParams.get("since");
  const sinceDate = since && !Number.isNaN(Date.parse(since)) ? new Date(since) : new Date(Date.now() - 60_000);

  const requests = await prisma.request.findMany({
    where: { status: "DICEK", createdAt: { gt: sinceDate } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  return NextResponse.json({
    requests: requests.map((r) => ({
      id: r.id,
      ticketNumber: r.ticketNumber,
      applicantName: r.applicantName,
      serviceLabel: serviceLabel(r.serviceType),
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
