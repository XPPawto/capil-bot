"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Poll ulang page.tsx (Server Component) tiap beberapa detik - begitu gembok dibuka lewat
// Telegram, admin tidak perlu ingat untuk refresh manual, halaman ini menutup dirinya sendiri
// dan mengganti ke <PinGate /> (atau langsung isinya kalau PIN cookie masih valid) begitu
// server melihat unlockedUntil sudah lewat masa sekarang.
const POLL_MS = 5000;

export function MasterLockScreen() {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(interval);
  }, [router]);

  return (
    <div className="flex h-[calc(100vh-7.5rem)] min-h-[420px] flex-col items-center justify-center gap-3 rounded-xl border border-line bg-surface px-6 text-center shadow-sm">
      <div>
        <h1 className="font-serif text-xl italic tracking-tight text-ink">🔒 Terkunci</h1>
        <p className="mt-1.5 max-w-xs text-sm text-ink-muted">
          Halaman ini sengaja tertutup secara default. Kirim{" "}
          <span className="rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-xs">/unlock 5m</span> ke bot
          Telegram untuk membukanya sementara.
        </p>
      </div>
      <p className="text-xs text-ink-faint">Halaman ini otomatis memeriksa ulang setiap beberapa detik.</p>
    </div>
  );
}
