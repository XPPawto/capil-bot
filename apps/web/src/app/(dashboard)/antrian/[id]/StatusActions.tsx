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

  if (status === "DITOLAK" || status === "SELESAI") {
    return (
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-500">Tidak ada aksi lebih lanjut untuk status ini.</p>
        <DeleteRequestButton requestId={requestId} redirectTo="/riwayat" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {status === "DICEK" && (
          <button
            disabled={isPending}
            onClick={() => updateStatus("DIPROSES")}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Proses Pengajuan
          </button>
        )}
        {status === "DIPROSES" && (
          <>
            <button
              disabled={isPending}
              onClick={sendReadyForPickup}
              className="rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {readyForPickupSentAt ? "Kirim Ulang Notifikasi Siap Diambil" : "Kirim Notifikasi Siap Diambil"}
            </button>
            <button
              disabled={isPending}
              onClick={() => updateStatus("SELESAI")}
              className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              Tandai Selesai (manual)
            </button>
          </>
        )}
        <button
          disabled={isPending}
          onClick={() => setShowRejectForm((v) => !v)}
          className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Tolak
        </button>
      </div>

      {status === "DIPROSES" && (
        <p className="text-xs text-neutral-500">
          {readyForPickupSentAt
            ? `Notifikasi siap diambil terakhir dikirim ${new Date(readyForPickupSentAt).toLocaleString("id-ID")}`
            : "Notifikasi siap diambil belum pernah dikirim."}
          {pickupNotice ? ` - ${pickupNotice}` : ""}
        </p>
      )}

      {showRejectForm && (
        <div className="flex flex-col gap-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Alasan penolakan"
            rows={3}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          <button
            disabled={isPending || !reason.trim()}
            onClick={() => updateStatus("DITOLAK", reason)}
            className="w-fit rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Konfirmasi Tolak
          </button>
        </div>
      )}
    </div>
  );
}
