"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RequestStatus } from "@kelurahan/db";
import { DeleteRequestButton } from "../../riwayat/DeleteRequestButton";

interface StatusActionsProps {
  requestId: string;
  status: RequestStatus;
  readyForPickupSentAt: string | null;
}

const REJECTION_TEMPLATES = [
  "Foto KTP tidak jelas/buram, mohon kirim ulang dengan pencahayaan yang cukup.",
  "Berkas belum lengkap, ada syarat yang belum terkirim.",
  "Data pada berkas tidak sesuai dengan Kartu Keluarga.",
  "Nama pemohon tidak sesuai dengan KTP.",
  "Dokumen sudah tidak berlaku/kedaluwarsa.",
  "Berkas yang dikirim buram/terpotong, mohon foto ulang seluruh dokumen.",
];

export function StatusActions({ requestId, status, readyForPickupSentAt }: StatusActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickupNotice, setPickupNotice] = useState<string | null>(null);

  async function updateStatus(nextStatus: RequestStatus, note?: string) {
    setError(null);
    const res = await fetch(`/api/requests/${requestId}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: nextStatus, note }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "reason_required"
          ? "Alasan penolakan wajib diisi."
          : data.error === "conflict"
            ? "Status sudah berubah oleh petugas lain, muat ulang halaman."
            : "Gagal mengubah status."
      );
      return;
    }
    setShowRejectForm(false);
    setReason("");
    startTransition(() => router.refresh());
  }

  async function sendReadyForPickup() {
    setError(null);
    setPickupNotice(null);
    const res = await fetch(`/api/requests/${requestId}/ready-for-pickup`, { method: "POST" });
    if (!res.ok) {
      setError("Gagal mengirim notifikasi siap diambil.");
      return;
    }
    setPickupNotice("Notifikasi terkirim.");
    startTransition(() => router.refresh());
  }

  function handleManualComplete() {
    if (window.confirm("Tandai pengajuan ini SELESAI secara manual? Biasanya ini dilakukan lewat scan QR.")) {
      void updateStatus("SELESAI");
    }
  }

  if (status === "DITOLAK" || status === "SELESAI") {
    return (
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">Tidak ada aksi lebih lanjut untuk status ini.</p>
        <DeleteRequestButton requestId={requestId} redirectTo="/riwayat" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="rounded-md bg-pastel-red px-3 py-2 text-sm text-pastel-red-ink">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {status === "DICEK" && (
          <button
            disabled={isPending}
            onClick={() => updateStatus("DIPROSES")}
            className="rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-canvas transition-colors hover:opacity-90 disabled:opacity-50"
          >
            Proses Pengajuan
          </button>
        )}
        {status === "DIPROSES" && (
          <>
            <button
              disabled={isPending}
              onClick={sendReadyForPickup}
              className="rounded-md border border-pastel-yellow-ink/30 px-3.5 py-2 text-sm font-medium text-pastel-yellow-ink transition-colors hover:bg-pastel-yellow disabled:opacity-50"
            >
              {readyForPickupSentAt ? "Kirim Ulang Notifikasi Siap Diambil" : "Kirim Notifikasi Siap Diambil"}
            </button>
            <button
              disabled={isPending}
              onClick={handleManualComplete}
              className="rounded-md border border-pastel-green-ink/30 px-3.5 py-2 text-sm font-medium text-pastel-green-ink transition-colors hover:bg-pastel-green disabled:opacity-50"
            >
              Tandai Selesai (manual)
            </button>
          </>
        )}
        <button
          disabled={isPending}
          onClick={() => setShowRejectForm((v) => !v)}
          className="rounded-md border border-pastel-red-ink/30 px-3.5 py-2 text-sm font-medium text-pastel-red-ink transition-colors hover:bg-pastel-red disabled:opacity-50"
        >
          Tolak
        </button>
      </div>

      {status === "DIPROSES" && (
        <p className="text-xs text-ink-muted">
          {readyForPickupSentAt
            ? `Notifikasi siap diambil terakhir dikirim ${new Date(readyForPickupSentAt).toLocaleString("id-ID")}`
            : "Notifikasi siap diambil belum pernah dikirim."}
          {pickupNotice ? ` - ${pickupNotice}` : ""}
        </p>
      )}

      {showRejectForm && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-canvas p-3">
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) setReason(e.target.value);
              e.target.value = "";
            }}
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink"
          >
            <option value="" disabled>
              Pilih alasan umum (opsional, tetap bisa diedit)...
            </option>
            {REJECTION_TEMPLATES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Alasan penolakan (akan dikirim ke warga)"
            rows={3}
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink"
          />
          <button
            disabled={isPending || !reason.trim()}
            onClick={() => updateStatus("DITOLAK", reason)}
            className="w-fit rounded-md bg-pastel-red-ink px-3.5 py-2 text-sm font-medium text-canvas transition-colors hover:opacity-90 disabled:opacity-50"
          >
            Konfirmasi Tolak
          </button>
        </div>
      )}
    </div>
  );
}
