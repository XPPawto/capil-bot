import Link from "next/link";
import type { Prisma, RequestStatus, ServiceType } from "@kelurahan/db";
import { prisma } from "@/lib/prisma";
import { formatDateTime, serviceLabel, statusBadgeClass, statusLabel } from "@/lib/format";
import { logSuspiciousFields } from "@/lib/securityLog";
import { DeleteRequestButton } from "./DeleteRequestButton";

interface RiwayatSearchParams {
  status?: string;
  serviceType?: string;
  q?: string;
  dari?: string;
  sampai?: string;
  page?: string;
}

const PAGE_SIZE = 25;

function buildPageHref(sp: RiwayatSearchParams, page: number): string {
  const params = new URLSearchParams();
  if (sp.q) params.set("q", sp.q);
  if (sp.status) params.set("status", sp.status);
  if (sp.serviceType) params.set("serviceType", sp.serviceType);
  if (sp.dari) params.set("dari", sp.dari);
  if (sp.sampai) params.set("sampai", sp.sampai);
  params.set("page", String(page));
  return `/riwayat?${params.toString()}`;
}

export default async function RiwayatPage({
  searchParams,
}: {
  searchParams: Promise<RiwayatSearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  await logSuspiciousFields("/riwayat", { q: sp.q, status: sp.status, serviceType: sp.serviceType });

  const where: Prisma.RequestWhereInput = {
    status: { in: ["DITOLAK", "SELESAI"] },
  };

  if (sp.status === "DITOLAK" || sp.status === "SELESAI") {
    where.status = sp.status as RequestStatus;
  }
  const validServiceTypes: ServiceType[] = [
    "KARTU_KELUARGA",
    "KK_BARCODE",
    "KK_PISAH",
    "KK_TAMBAH_ANGGOTA",
    "AKTE_KEMATIAN",
    "AKTE_KELAHIRAN",
  ];
  if (sp.serviceType && validServiceTypes.includes(sp.serviceType as ServiceType)) {
    where.serviceType = sp.serviceType as ServiceType;
  }
  if (sp.q) {
    where.OR = [
      { applicantName: { contains: sp.q } },
      { waNumber: { contains: sp.q } },
      { ticketNumber: { contains: sp.q } },
    ];
  }
  if (sp.dari || sp.sampai) {
    where.createdAt = {
      ...(sp.dari ? { gte: new Date(sp.dari) } : {}),
      ...(sp.sampai ? { lte: new Date(`${sp.sampai}T23:59:59`) } : {}),
    };
  }

  const [requests, total] = await Promise.all([
    prisma.request.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.request.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilter = Boolean(sp.q || sp.status || sp.serviceType || sp.dari || sp.sampai);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-3xl italic tracking-tight text-ink">Riwayat</h1>
        <p className="mt-1 text-sm text-ink-muted">Pengajuan yang sudah selesai atau ditolak &middot; {total} total.</p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-muted">Cari nama/nomor/tiket</label>
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-muted">Status</label>
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink"
          >
            <option value="">Semua</option>
            <option value="SELESAI">Selesai</option>
            <option value="DITOLAK">Ditolak</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-muted">Layanan</label>
          <select
            name="serviceType"
            defaultValue={sp.serviceType ?? ""}
            className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink"
          >
            <option value="">Semua</option>
            <option value="KK_BARCODE">KK Barcode</option>
            <option value="KK_PISAH">Pisah KK (Pasangan Baru Menikah)</option>
            <option value="KK_TAMBAH_ANGGOTA">Tambah Anggota Keluarga (Anak)</option>
            <option value="AKTE_KEMATIAN">Akte Kematian</option>
            <option value="AKTE_KELAHIRAN">Akte Kelahiran</option>
            <option value="KARTU_KELUARGA">Kartu Keluarga (lama)</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-muted">Dari</label>
          <input
            type="date"
            name="dari"
            defaultValue={sp.dari ?? ""}
            className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-muted">Sampai</label>
          <input
            type="date"
            name="sampai"
            defaultValue={sp.sampai ?? ""}
            className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-canvas transition-colors hover:opacity-90"
        >
          Filter
        </button>
        {hasFilter && (
          <Link href="/riwayat" className="text-sm text-ink-muted hover:text-ink hover:underline">
            Reset
          </Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="min-w-full divide-y divide-line text-sm">
          <thead className="bg-canvas text-left text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">No. Tiket</th>
              <th className="px-4 py-3 font-medium">Pemohon</th>
              <th className="px-4 py-3 font-medium">Layanan</th>
              <th className="hidden px-4 py-3 font-medium sm:table-cell">Nomor WA</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Terakhir Diperbarui</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {requests.map((r) => (
              <tr key={r.id} className="transition-colors hover:bg-surface-hover">
                <td className="px-4 py-3 font-mono text-xs text-ink">{r.ticketNumber}</td>
                <td className="px-4 py-3 text-ink">{r.applicantName}</td>
                <td className="px-4 py-3 text-ink-muted">{serviceLabel(r.serviceType)}</td>
                <td className="hidden px-4 py-3 text-ink-muted sm:table-cell">{r.waNumber}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(r.status)}`}>
                    {statusLabel(r.status)}
                  </span>
                </td>
                <td className="hidden px-4 py-3 text-ink-muted md:table-cell">
                  {r.pickupConfirmedAt ? formatDateTime(r.pickupConfirmedAt) : formatDateTime(r.updatedAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <Link href={`/antrian/${r.id}`} className="text-sm font-medium text-pastel-blue-ink hover:underline">
                      Detail
                    </Link>
                    <DeleteRequestButton requestId={r.id} />
                  </div>
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-muted">
                  Tidak ada data.
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
            <Link
              href={buildPageHref(sp, Math.max(1, page - 1))}
              aria-disabled={page <= 1}
              className={`rounded-md border border-line px-3 py-1.5 transition-colors ${
                page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-surface-hover"
              }`}
            >
              Sebelumnya
            </Link>
            <Link
              href={buildPageHref(sp, Math.min(totalPages, page + 1))}
              aria-disabled={page >= totalPages}
              className={`rounded-md border border-line px-3 py-1.5 transition-colors ${
                page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-surface-hover"
              }`}
            >
              Berikutnya
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
