import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDateTime, serviceLabel, statusBadgeClass, statusLabel } from "@/lib/format";

export default async function AntrianPage() {
  const requests = await prisma.request.findMany({
    where: { status: { in: ["DICEK", "DIPROSES"] } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Antrian</h1>
        <p className="text-sm text-neutral-500">Pengajuan yang masih menunggu diproses petugas.</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">No. Tiket</th>
              <th className="px-4 py-2 font-medium">Pemohon</th>
              <th className="px-4 py-2 font-medium">Layanan</th>
              <th className="px-4 py-2 font-medium">Nomor WA</th>
              <th className="px-4 py-2 font-medium">Diajukan</th>
              <th className="px-4 py-2 font-medium">Status</th>
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
                <td className="px-4 py-2 text-neutral-700">{formatDateTime(r.createdAt)}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusBadgeClass(r.status)}`}>
                    {statusLabel(r.status)}
                  </span>
                  {r.status === "DIPROSES" && (
                    <span className="ml-1 rounded-full bg-neutral-100 px-2 py-1 text-xs text-neutral-500">
                      {r.readyForPickupSentAt ? "Siap diambil" : "Belum siap"}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/antrian/${r.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                    Lihat
                  </Link>
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-neutral-400">
                  Tidak ada antrian saat ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
