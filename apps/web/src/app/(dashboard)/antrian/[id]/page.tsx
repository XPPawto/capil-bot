import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDateTime, serviceLabel, statusBadgeClass, statusLabel } from "@/lib/format";
import { StatusActions } from "./StatusActions";

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const request = await prisma.request.findUnique({
    where: { id },
    include: {
      documents: true,
      statusHistories: { orderBy: { changedAt: "asc" }, include: { changedBy: true } },
    },
  });

  if (!request) notFound();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">{request.applicantName}</h1>
        <p className="text-sm text-neutral-500">
          {serviceLabel(request.serviceType)} &middot; {request.waNumber} &middot; No. Tiket:{" "}
          <span className="font-medium text-neutral-700">{request.ticketNumber}</span>
        </p>
      </div>

      <div className="flex items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusBadgeClass(request.status)}`}>
          {statusLabel(request.status)}
        </span>
        <span className="text-sm text-neutral-500">Diajukan {formatDateTime(request.createdAt)}</span>
      </div>

      {request.status === "DITOLAK" && request.rejectionReason && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Alasan penolakan: {request.rejectionReason}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-neutral-900">Berkas Syarat</h2>
        <p className="text-xs text-neutral-500">Klik pratinjau untuk membuka ukuran penuh di tab baru.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {request.documents.map((doc) => (
            <a
              key={doc.id}
              href={`/api/files/${doc.id}`}
              target="_blank"
              rel="noreferrer"
              className="group flex flex-col gap-1.5 rounded-lg border border-neutral-200 p-2 hover:border-blue-400"
            >
              <div className="flex h-36 items-center justify-center overflow-hidden rounded-md bg-neutral-100">
                {doc.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/files/${doc.id}`}
                    alt={doc.requirementName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <iframe
                    src={`/api/files/${doc.id}`}
                    title={doc.requirementName}
                    className="h-full w-full"
                    tabIndex={-1}
                  />
                )}
              </div>
              <span className="line-clamp-2 text-xs text-neutral-600 group-hover:text-blue-600">
                {doc.requirementName}
              </span>
            </a>
          ))}
          {request.documents.length === 0 && (
            <p className="col-span-full text-sm text-neutral-400">Belum ada berkas.</p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-neutral-900">Aksi</h2>
        <StatusActions
          requestId={request.id}
          status={request.status}
          readyForPickupSentAt={request.readyForPickupSentAt?.toISOString() ?? null}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-neutral-900">Riwayat Status</h2>
        <ul className="flex flex-col gap-1 text-sm text-neutral-600">
          {request.statusHistories.map((h) => (
            <li key={h.id}>
              {formatDateTime(h.changedAt)} &mdash; {statusLabel(h.status)}
              {h.changedBy ? ` oleh ${h.changedBy.name}` : ""}
              {h.note ? `: ${h.note}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
