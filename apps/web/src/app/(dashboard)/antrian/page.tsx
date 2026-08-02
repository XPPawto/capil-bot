import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { servicePriorityWeight } from "@/lib/format";
import { AntrianTable } from "./AntrianTable";

export default async function AntrianPage() {
  const requests = await prisma.request.findMany({
    where: { status: { in: ["DICEK", "DIPROSES"] } },
    orderBy: { createdAt: "asc" },
  });

  // Priority queue: bobot layanan dulu (Akte Kematian > Akte Kelahiran > KK), createdAt
  // cuma jadi tiebreak di bobot yang sama (FIFO di dalam kelompok prioritas yang sama).
  // Diurutkan di JS (bukan SQL) - jumlah baris antrian kelurahan kecil, tidak perlu raw query.
  const sorted = [...requests].sort((a, b) => {
    const weightDiff = servicePriorityWeight(b.serviceType) - servicePriorityWeight(a.serviceType);
    if (weightDiff !== 0) return weightDiff;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const rows = sorted.map((r) => ({
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
        <p className="mt-1 text-sm text-ink-muted">
          Diurutkan berdasarkan prioritas layanan (mendesak dulu), lalu waktu masuk.
        </p>
      </div>

      <Suspense fallback={<p className="text-sm text-ink-muted">Memuat...</p>}>
        <AntrianTable rows={rows} />
      </Suspense>
    </div>
  );
}
