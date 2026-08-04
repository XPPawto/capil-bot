import { notFound } from "next/navigation";
import type { RequestStatus } from "@kelurahan/db";
import { prisma } from "@/lib/prisma";
import { formatDateTime, maskName, serviceLabel } from "@/lib/format";
import { Logo } from "@/components/Logo";

const STEP_ORDER: { status: RequestStatus; label: string; description: string }[] = [
  { status: "DICEK", label: "Diajukan", description: "Berkas diterima, menunggu pemeriksaan petugas." },
  { status: "DIPROSES", label: "Diproses", description: "Berkas lengkap dan sedang dikerjakan petugas." },
  { status: "SELESAI", label: "Selesai", description: "Dokumen sudah bisa diambil / telah diambil." },
];

export default async function TrackPage({
  params,
}: {
  params: Promise<{ trackingToken: string }>;
}) {
  const { trackingToken } = await params;
  // Sengaja dicari lewat trackingToken (token acak panjang), BUKAN ticketNumber - ticketNumber
  // formatnya sekuensial per layanan+bulan sehingga gampang ditebak orang lain (IDOR risk).
  // trackingToken cuma dikirim bot ke WhatsApp pemohon aslinya, jadi jadi "kunci" halaman ini.
  const request = await prisma.request.findUnique({
    where: { trackingToken },
  });

  if (!request) notFound();

  const isRejected = request.status === "DITOLAK";
  const currentStepIndex = isRejected ? -1 : STEP_ORDER.findIndex((s) => s.status === request.status);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-5 py-12">
      <div className="flex items-center gap-2.5">
        <Logo size={32} />
        <span className="text-sm font-medium text-ink">Kelurahan Digital</span>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5">
        <p className="text-xs uppercase tracking-wide text-ink-muted">Lacak Status Pengajuan</p>
        <h1 className="mt-1 font-mono text-2xl text-ink">{request.ticketNumber}</h1>
        <div className="mt-3 flex flex-col gap-1 text-sm text-ink-muted">
          <p>
            Pemohon: <span className="text-ink">{maskName(request.applicantName)}</span>
          </p>
          <p>
            Layanan: <span className="text-ink">{serviceLabel(request.serviceType)}</span>
          </p>
          <p>
            Diajukan: <span className="text-ink">{formatDateTime(request.createdAt)}</span>
          </p>
        </div>
      </div>

      {isRejected ? (
        <div className="rounded-xl border border-line bg-pastel-red p-5">
          <p className="text-sm font-medium text-pastel-red-ink">Pengajuan Ditolak</p>
          {request.rejectionReason && <p className="mt-1.5 text-sm text-pastel-red-ink">{request.rejectionReason}</p>}
          <p className="mt-2 text-xs text-pastel-red-ink/80">
            Silakan hubungi petugas kelurahan atau ajukan ulang lewat WhatsApp bila diperlukan.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-surface p-5">
          <ol className="flex flex-col gap-0">
            {STEP_ORDER.map((step, idx) => {
              const isDone = idx < currentStepIndex;
              const isCurrent = idx === currentStepIndex;
              const isLast = idx === STEP_ORDER.length - 1;
              return (
                <li key={step.status} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${
                        isDone || isCurrent
                          ? "border-ink bg-ink text-canvas"
                          : "border-line bg-canvas text-ink-muted"
                      }`}
                    >
                      {isDone ? "✓" : idx + 1}
                    </div>
                    {!isLast && <div className={`w-px flex-1 ${isDone ? "bg-ink" : "bg-line"}`} style={{ minHeight: "2.5rem" }} />}
                  </div>
                  <div className={`pb-8 ${isLast ? "pb-0" : ""}`}>
                    <p className={`text-sm font-medium ${isDone || isCurrent ? "text-ink" : "text-ink-muted"}`}>
                      {step.label}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-muted">{step.description}</p>
                    {isCurrent && step.status === "DIPROSES" && request.readyForPickupSentAt && (
                      <p className="mt-1 text-xs font-medium text-pastel-blue-ink">
                        QR pengambilan sudah dikirim lewat WhatsApp Anda.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <p className="text-center text-xs text-ink-muted">
        Punya pertanyaan? Balas pesan WhatsApp dari nomor kelurahan atau ketik <span className="font-mono">status</span> di
        chat bot.
      </p>
    </div>
  );
}
