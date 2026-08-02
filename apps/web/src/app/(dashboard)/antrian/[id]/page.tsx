import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDateTime, serviceLabel, statusBadgeClass, statusLabel } from "@/lib/format";
import { BackLink } from "@/components/BackLink";
import { StatusActions } from "./StatusActions";
import { MessageThread } from "./MessageThread";
import { DocumentGallery } from "./DocumentGallery";
import { AutoRefresh } from "./AutoRefresh";
import { TakeoverToggle } from "./TakeoverToggle";

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const request = await prisma.request.findUnique({
    where: { id },
    include: {
      documents: true,
      statusHistories: { orderBy: { changedAt: "asc" }, include: { changedBy: true } },
      messages: { orderBy: { createdAt: "asc" }, include: { admin: true } },
    },
  });

  if (!request) notFound();

  const takeover = await prisma.humanTakeover.findUnique({ where: { waJid: request.waJid } });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <AutoRefresh />
      <BackLink href="/antrian" label="Kembali ke Antrian" />

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl italic tracking-tight text-ink">{request.applicantName}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {serviceLabel(request.serviceType)} &middot; {request.waNumber}
          </p>
          <p className="mt-1 font-mono text-xs text-ink-muted">No. Tiket: {request.ticketNumber}</p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusBadgeClass(request.status)}`}>
            {statusLabel(request.status)}
          </span>
          <span className="text-xs text-ink-muted">Diajukan {formatDateTime(request.createdAt)}</span>
        </div>
      </div>

      {request.status === "DITOLAK" && request.rejectionReason && (
        <p className="rounded-lg bg-pastel-red px-4 py-3 text-sm text-pastel-red-ink">
          Alasan penolakan: {request.rejectionReason}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-medium text-ink">Berkas Syarat</h2>
          <p className="text-xs text-ink-muted">Klik pratinjau untuk melihat ukuran penuh.</p>
        </div>
        <DocumentGallery
          documents={request.documents.map((d) => ({
            id: d.id,
            requirementName: d.requirementName,
            mimeType: d.mimeType,
            ocrNik: d.ocrNik,
            ocrRawText: d.ocrRawText,
          }))}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Aksi</h2>
        <StatusActions
          requestId={request.id}
          status={request.status}
          readyForPickupSentAt={request.readyForPickupSentAt?.toISOString() ?? null}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Percakapan dengan Warga</h2>
        <TakeoverToggle requestId={request.id} initialActive={takeover !== null} />
        <MessageThread
          requestId={request.id}
          messages={request.messages.map((m) => ({
            id: m.id,
            direction: m.direction,
            message: m.message,
            createdAt: m.createdAt.toISOString(),
            adminName: m.admin?.name ?? null,
          }))}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Riwayat Status</h2>
        <ul className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-sm text-ink-muted">
          {request.statusHistories.map((h) => (
            <li key={h.id} className="border-b border-line pb-2 last:border-0 last:pb-0">
              <span className="font-medium text-ink">{statusLabel(h.status)}</span>
              {" — "}
              {formatDateTime(h.changedAt)}
              {h.changedBy ? ` oleh ${h.changedBy.name}` : ""}
              {h.note ? `: ${h.note}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
