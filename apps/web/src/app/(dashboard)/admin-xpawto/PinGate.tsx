"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PinGate() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inbox/verify-pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        setError("PIN salah.");
        setPin("");
        return;
      }
      // Cookie sudah diset server - muat ulang Server Component supaya page.tsx
      // membaca ulang status PIN dan menampilkan isi halaman yang sebenarnya.
      router.refresh();
    } catch {
      setError("Gagal memverifikasi PIN: koneksi ke server terputus.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-7.5rem)] min-h-[420px] flex-col items-center justify-center gap-4 rounded-xl border border-line bg-surface px-6 text-center shadow-sm">
      <div>
        <h1 className="font-serif text-xl italic tracking-tight text-ink">Masukkan PIN</h1>
        <p className="mt-1 text-sm text-ink-muted">Halaman ini dilindungi PIN tambahan.</p>
      </div>
      <form onSubmit={handleSubmit} className="flex w-full max-w-[220px] flex-col items-center gap-3">
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          className="w-full rounded-md border border-line bg-canvas px-3 py-2.5 text-center text-lg tracking-[0.3em] text-ink outline-none transition-colors focus:border-ink"
        />
        {error && <p className="text-xs text-pastel-red-ink">{error}</p>}
        <button
          type="submit"
          disabled={busy || !pin.trim()}
          className="w-full rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-canvas transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Memeriksa..." : "Masuk"}
        </button>
      </form>
    </div>
  );
}
