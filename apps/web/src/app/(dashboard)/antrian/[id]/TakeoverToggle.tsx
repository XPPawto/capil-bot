"use client";

import { useState } from "react";

export function TakeoverToggle({
  requestId,
  active,
  onToggled,
}: {
  requestId: string;
  active: boolean;
  onToggled: (next: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !active;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/takeover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      if (!res.ok) {
        setError("Gagal mengubah mode percakapan. Coba lagi.");
        return;
      }
      onToggled(next);
    } catch {
      setError("Gagal mengubah mode percakapan: koneksi ke server terputus. Periksa koneksi internet Anda.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
          active ? "border-pastel-yellow-ink/30 bg-pastel-yellow" : "border-line bg-surface"
        }`}
      >
        <div>
          <p className={`text-sm font-medium ${active ? "text-pastel-yellow-ink" : "text-ink"}`}>
            {active ? "Anda sedang mengambil alih percakapan ini" : "Bot menjawab otomatis"}
          </p>
          <p className={`mt-0.5 text-xs ${active ? "text-pastel-yellow-ink/80" : "text-ink-muted"}`}>
            {active
              ? "Bot tidak akan membalas warga ini sampai Anda melepas mode ini. Warga sudah diberi tahu lewat WA."
              : "Aktifkan kalau Anda ingin membalas warga secara manual - bot akan berhenti auto-reply dan warga diberi tahu."}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className={`shrink-0 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
            active ? "bg-ink text-white hover:bg-[#333333]" : "border border-line text-ink hover:bg-surface-hover"
          }`}
        >
          {pending ? "Memproses..." : active ? "Lepas, kembalikan ke bot" : "Ambil Alih Percakapan"}
        </button>
      </div>
      {error && <p className="text-sm text-pastel-red-ink">{error}</p>}
    </div>
  );
}
