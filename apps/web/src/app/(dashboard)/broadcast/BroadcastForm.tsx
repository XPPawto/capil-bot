"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function BroadcastForm({ recipientCount }: { recipientCount: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSend() {
    const trimmed = message.trim();
    if (!trimmed) return;

    const confirmed = window.confirm(
      `Kirim pesan ini ke ${recipientCount} nomor warga? Pesan akan terkirim bertahap (ada jeda antar nomor), ` +
        `jadi butuh beberapa saat sampai semua kebagian. Aksi ini tidak bisa dibatalkan setelah dikirim.`
    );
    if (!confirmed) return;

    setSending(true);
    setError(null);
    setSuccess(null);
    const res = await fetch("/api/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: trimmed }),
    });
    setSending(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "not_connected"
          ? "Bot WA sedang tidak terhubung."
          : data.error === "no_recipients"
            ? "Belum ada warga yang pernah berinteraksi dengan bot."
            : "Gagal memulai broadcast."
      );
      return;
    }

    setMessage("");
    setSuccess(`Broadcast dimulai ke ${recipientCount} nomor. Pengiriman berjalan bertahap di latar belakang.`);
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
      <div>
        <p className="text-sm font-medium text-ink">Kirim Pengumuman</p>
        <p className="text-xs text-ink-muted">
          Akan terkirim ke <span className="font-medium text-ink">{recipientCount} nomor</span> warga yang
          pernah punya pengajuan.
        </p>
      </div>

      {error && <p className="rounded-md bg-pastel-red px-3 py-2 text-sm text-pastel-red-ink">{error}</p>}
      {success && <p className="rounded-md bg-pastel-green px-3 py-2 text-sm text-pastel-green-ink">{success}</p>}

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        placeholder="Contoh: Diberitahukan kepada warga, besok kantor kelurahan tutup karena libur nasional."
        className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink"
      />
      <button
        onClick={handleSend}
        disabled={sending || !message.trim() || recipientCount === 0}
        className="w-fit rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#333333] disabled:opacity-50"
      >
        {sending ? "Memulai..." : "Kirim ke Semua Warga"}
      </button>
    </div>
  );
}
