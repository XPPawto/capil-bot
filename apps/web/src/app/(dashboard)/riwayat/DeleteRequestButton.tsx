"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function DeleteRequestButton({ requestId, redirectTo }: { requestId: string; redirectTo?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    const confirmed = window.confirm(
      "Hapus riwayat pengajuan ini secara permanen? Berkas syarat yang tersimpan juga akan ikut terhapus dan tidak bisa dikembalikan."
    );
    if (!confirmed) return;

    setError(null);
    const res = await fetch(`/api/requests/${requestId}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Gagal menghapus riwayat.");
      return;
    }

    startTransition(() => {
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className="text-sm font-medium text-pastel-red-ink hover:underline disabled:opacity-50"
      >
        Hapus
      </button>
      {error && <span className="text-xs text-pastel-red-ink">{error}</span>}
    </span>
  );
}
