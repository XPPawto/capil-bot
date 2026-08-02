import type { ServiceType } from "@kelurahan/db";
import { prisma } from "@/lib/prisma";
import { serviceLabel } from "@/lib/format";
import { IconStar } from "@/components/icons";

const SERVICE_TYPES: ServiceType[] = ["KARTU_KELUARGA", "AKTE_KEMATIAN", "AKTE_KELAHIRAN"];

export default async function KepuasanPage() {
  const [overall, perServiceRating, usagePerService, distribution] = await Promise.all([
    prisma.request.aggregate({ where: { rating: { not: null } }, _avg: { rating: true }, _count: { rating: true } }),
    prisma.request.groupBy({
      by: ["serviceType"],
      where: { rating: { not: null } },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    prisma.request.groupBy({ by: ["serviceType"], _count: { _all: true } }),
    prisma.request.groupBy({ by: ["rating"], where: { rating: { not: null } }, _count: { rating: true } }),
  ]);

  const ratingByService = new Map(perServiceRating.map((r) => [r.serviceType, r]));
  const usageByService = new Map(usagePerService.map((r) => [r.serviceType, r._count._all]));
  const totalUsage = usagePerService.reduce((sum, r) => sum + r._count._all, 0);

  const ratingRanking = SERVICE_TYPES.filter((s) => ratingByService.has(s))
    .map((s) => ({ serviceType: s, avg: ratingByService.get(s)!._avg.rating ?? 0, count: ratingByService.get(s)!._count.rating }))
    .sort((a, b) => b.avg - a.avg);

  const usageRanking = SERVICE_TYPES.map((s) => ({ serviceType: s, count: usageByService.get(s) ?? 0 })).sort(
    (a, b) => b.count - a.count
  );

  const distributionMap = new Map(distribution.map((d) => [d.rating, d._count.rating]));
  const maxDistCount = Math.max(1, ...[1, 2, 3, 4, 5].map((r) => distributionMap.get(r) ?? 0));

  const overallAvg = overall._avg.rating ?? 0;
  const overallCount = overall._count.rating;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-serif text-3xl italic tracking-tight text-ink">Indeks Kepuasan</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Rekap penilaian warga (1-5) setelah pengambilan dokumen, dan seberapa sering tiap layanan dipakai.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Rata-rata Kepuasan</p>
          <p className="mt-1 font-serif text-5xl text-ink">{overallAvg.toFixed(1)}</p>
          <p className="mt-1 text-xs text-ink-muted">dari {overallCount} penilaian warga</p>
        </div>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <IconStar
              key={n}
              className={`h-6 w-6 ${n <= Math.round(overallAvg) ? "fill-pastel-yellow-ink text-pastel-yellow-ink" : "text-line"}`}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-medium text-ink">Rating Terbaik per Layanan</h2>
          {ratingRanking.length === 0 && <p className="text-sm text-ink-muted">Belum ada penilaian masuk.</p>}
          {ratingRanking.map((r, idx) => (
            <div key={r.serviceType} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-ink">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-pastel-yellow text-[10px] font-semibold text-pastel-yellow-ink">
                  {idx + 1}
                </span>
                {serviceLabel(r.serviceType)}
              </span>
              <span className="flex items-center gap-1 text-ink-muted">
                <IconStar className="h-3.5 w-3.5 fill-pastel-yellow-ink text-pastel-yellow-ink" />
                {r.avg.toFixed(1)} ({r.count})
              </span>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-medium text-ink">Layanan Paling Banyak Dipakai</h2>
          {usageRanking.map((r, idx) => (
            <div key={r.serviceType} className="flex flex-col gap-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-ink">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-pastel-blue text-[10px] font-semibold text-pastel-blue-ink">
                    {idx + 1}
                  </span>
                  {serviceLabel(r.serviceType)}
                </span>
                <span className="text-ink-muted">{r.count} pengajuan</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-canvas">
                <div
                  className="h-full rounded-full bg-pastel-blue-ink"
                  style={{ width: totalUsage ? `${(r.count / totalUsage) * 100}%` : "0%" }}
                />
              </div>
            </div>
          ))}
        </section>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
        <h2 className="text-sm font-medium text-ink">Distribusi Penilaian</h2>
        <div className="flex flex-col gap-2">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = distributionMap.get(star) ?? 0;
            return (
              <div key={star} className="flex items-center gap-3 text-sm">
                <span className="w-10 shrink-0 text-ink-muted">{star} bintang</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-canvas">
                  <div
                    className="h-full rounded-full bg-pastel-yellow-ink"
                    style={{ width: `${(count / maxDistCount) * 100}%` }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right text-ink-muted">{count}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
