import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 50;

const PATTERN_BADGE: Record<string, string> = {
  SQLI: "bg-pastel-red text-pastel-red-ink",
  XSS: "bg-pastel-yellow text-pastel-yellow-ink",
};

export default async function KeamananPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [logs, total, last24h, byPattern, topIps] = await Promise.all([
    prisma.securityLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.securityLog.count(),
    prisma.securityLog.count({ where: { createdAt: { gte: since24h } } }),
    prisma.securityLog.groupBy({ by: ["pattern"], _count: { pattern: true } }),
    prisma.securityLog.groupBy({
      by: ["ip"],
      _count: { ip: true },
      orderBy: { _count: { ip: "desc" } },
      take: 5,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-3xl italic tracking-tight text-ink">Keamanan</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Monitoring pola input yang menyerupai percobaan SQL Injection / XSS pada formulir login, pencarian
          riwayat, dan validasi QR pengambilan.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4 text-sm text-ink-muted">
        Catatan ini bersifat <span className="font-medium text-ink">monitoring defense-in-depth</span>, bukan bukti
        sistem berhasil ditembus. Seluruh query database di aplikasi ini sudah memakai Prisma (parameterized query)
        sehingga tidak ada celah SQL Injection nyata untuk dieksploitasi — daftar di bawah ini murni membantu
        petugas melihat siapa saja yang sedang mencoba melakukan probing terhadap sistem.
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-xs text-ink-muted">Total Terekam</p>
          <p className="mt-1 font-serif text-2xl italic text-ink">{total}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-xs text-ink-muted">24 Jam Terakhir</p>
          <p className="mt-1 font-serif text-2xl italic text-ink">{last24h}</p>
        </div>
        {byPattern.map((p) => (
          <div key={p.pattern} className="rounded-xl border border-line bg-surface p-4">
            <p className="text-xs text-ink-muted">Pola {p.pattern}</p>
            <p className="mt-1 font-serif text-2xl italic text-ink">{p._count.pattern}</p>
          </div>
        ))}
      </div>

      {topIps.length > 0 && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">IP Paling Sering Terekam</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {topIps.map((row) => (
              <li key={row.ip} className="rounded-full border border-line bg-canvas px-3 py-1 font-mono text-xs text-ink-muted">
                {row.ip} &middot; {row._count.ip}x
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="min-w-full divide-y divide-line text-sm">
          <thead className="bg-canvas text-left text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Waktu</th>
              <th className="px-4 py-3 font-medium">Pola</th>
              <th className="px-4 py-3 font-medium">IP</th>
              <th className="px-4 py-3 font-medium">Lokasi</th>
              <th className="px-4 py-3 font-medium">Field</th>
              <th className="px-4 py-3 font-medium">Cuplikan Input</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {logs.map((log) => (
              <tr key={log.id} className="transition-colors hover:bg-surface-hover">
                <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{formatDateTime(log.createdAt)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PATTERN_BADGE[log.pattern] ?? "bg-canvas text-ink-muted"}`}>
                    {log.pattern}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink">{log.ip}</td>
                <td className="px-4 py-3 text-ink-muted">{log.path}</td>
                <td className="px-4 py-3 text-ink-muted">{log.field}</td>
                <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-ink-muted" title={log.value}>
                  {log.value}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-ink-muted">
                  Belum ada pola input mencurigakan yang terekam.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-muted">
          <span>
            Halaman {page} dari {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <a href={`/keamanan?page=${page - 1}`} className="rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover">
                Sebelumnya
              </a>
            )}
            {page < totalPages && (
              <a href={`/keamanan?page=${page + 1}`} className="rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover">
                Berikutnya
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
