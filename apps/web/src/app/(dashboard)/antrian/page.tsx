import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { AntrianTable } from "./AntrianTable";

export default async function AntrianPage() {
  const requests = await prisma.request.findMany({
    where: { status: { in: ["DICEK", "DIPROSES"] } },
    orderBy: { createdAt: "asc" },
  });

  const rows = requests.map((r) => ({
    id: r.id,
    ticketNumber: r.ticketNumber,
    applicantName: r.applicantName,
    serviceType: r.serviceType,
    waNumber: r.waNumber,
    createdAt: r.createdAt.toISOString(),
    status: r.status,
    readyForPickupSentAt: r.readyForPickupSentAt?.toISOString() ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-3xl italic tracking-tight text-ink">Antrian</h1>
        <p className="mt-1 text-sm text-ink-muted">Pengajuan yang masih menunggu diproses petugas.</p>
      </div>

      <Suspense fallback={<p className="text-sm text-ink-muted">Memuat...</p>}>
        <AntrianTable rows={rows} />
      </Suspense>
    </div>
  );
}
