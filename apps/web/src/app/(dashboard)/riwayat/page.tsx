import Link from "next/link";
import type { Prisma, RequestStatus, ServiceType } from "@kelurahan/db";
import { prisma } from "@/lib/prisma";
import { formatDateTime, serviceLabel, statusBadgeClass, statusLabel } from "@/lib/format";
import { DeleteRequestButton } from "./DeleteRequestButton";

interface RiwayatSearchParams {
  status?: string;
  serviceType?: string;
  q?: string;
  dari?: string;
  sampai?: string;
}

export default async function RiwayatPage({
  searchParams,
}: {
  searchParams: Promise<RiwayatSearchParams>;
}) {
  const sp = await searchParams;

  const where: Prisma.RequestWhereInput = {
    status: { in: ["DITOLAK", "SELESAI"] },
  };

  if (sp.status === "DITOLAK" || sp.status === "SELESAI") {
    where.status = sp.status as RequestStatus;
  }
  if (sp.serviceType && ["KARTU_KELUARGA", "AKTE_KEMATIAN", "AKTE_KELAHIRAN"].includes(sp.serviceType)) {
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

  const requests = await prisma.request.findMany({ where, orderBy: { updatedAt: "desc" }, take: 200 });
  const hasFilter = Boolean(sp.q || sp.status || sp.serviceType || sp.dari || sp.sampai);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Riwayat</h1>
        <p className="text-sm text-neutral-500">Pengajuan yang sudah selesai atau ditolak.</p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-600">Cari nama/nomor/tiket</label>
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-600">Status</label>
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          >
            <option value="">Semua</option>
            <option value="SELESAI">Selesai</option>
            <option value="DITOLAK">Ditolak</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-600">Layanan</label>
          <select
            name="serviceType"
            defaultValue={sp.serviceType ?? ""}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          >
            <option value="">Semua</option>
            <option value="KARTU_KELUARGA">Kartu Keluarga</option>
            <option value="AKTE_KEMATIAN">Akte Kematian</option>
            <option value="AKTE_KELAHIRAN">Akte Kelahiran</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-600">Dari</label>
          <input
            type="date"
            name="dari"
            defaultValue={sp.dari ?? ""}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-600">Sampai</label>
          <input
            type="date"
            name="sampai"
            defaultValue={sp.sampai ?? ""}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Filter
        </button>
        {hasFilter && (
          <Link href="/riwayat" className="text-sm text-neutral-500 hover:underline">
            Reset
          </Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">No. Tiket</th>
              <th className="px-4 py-2 font-medium">Pemohon</th>
              <th className="px-4 py-2 font-medium">Layanan</th>
              <th className="px-4 py-2 font-medium">Nomor WA</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Terakhir Diperbarui</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {requests.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 font-medium text-neutral-900">{r.ticketNumber}</td>
                <td className="px-4 py-2 text-neutral-900">{r.applicantName}</td>
                <td className="px-4 py-2 text-neutral-700">{serviceLabel(r.serviceType)}</td>
                <td className="px-4 py-2 text-neutral-700">{r.waNumber}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusBadgeClass(r.status)}`}>
                    {statusLabel(r.status)}
                  </span>
                </td>
                <td className="px-4 py-2 text-neutral-700">
                  {r.pickupConfirmedAt ? formatDateTime(r.pickupConfirmedAt) : formatDateTime(r.updatedAt)}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <Link href={`/antrian/${r.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                      Detail
                    </Link>
                    <DeleteRequestButton requestId={r.id} />
                  </div>
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-neutral-400">
                  Tidak ada data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
