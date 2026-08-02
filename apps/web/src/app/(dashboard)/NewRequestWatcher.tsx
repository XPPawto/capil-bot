"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface NewRequestNotice {
  id: string;
  ticketNumber: string;
  applicantName: string;
  serviceLabel: string;
}

const POLL_MS = 10000;
const AUTO_DISMISS_MS = 8000;

function playTing() {
  try {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.2, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.3);
    });

    setTimeout(() => ctx.close(), 800);
  } catch {
    // audio tidak tersedia/diblok browser - abaikan, notifikasi visual tetap muncul
  }
}

export function NewRequestWatcher() {
  const [notices, setNotices] = useState<NewRequestNotice[]>([]);
  const lastCheckedRef = useRef(new Date());

  useEffect(() => {
    const timer = setInterval(async () => {
      const since = lastCheckedRef.current.toISOString();
      lastCheckedRef.current = new Date();
      try {
        const res = await fetch(`/api/notifications/new-requests?since=${encodeURIComponent(since)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        const fresh: NewRequestNotice[] = data.requests ?? [];
        if (fresh.length > 0) {
          playTing();
          setNotices((prev) => [...fresh, ...prev].slice(0, 5));
          fresh.forEach((n) => {
            setTimeout(() => {
              setNotices((prev) => prev.filter((x) => x.id !== n.id));
            }, AUTO_DISMISS_MS);
          });
        }
      } catch {
        // koneksi bermasalah sementara - coba lagi di siklus berikutnya
      }
    }, POLL_MS);

    return () => clearInterval(timer);
  }, []);

  if (notices.length === 0) return null;

  return (
    <div className="fixed right-4 top-16 z-50 flex flex-col gap-2 md:top-4">
      {notices.map((n) => (
        <Link
          key={n.id}
          href={`/antrian/${n.id}`}
          className="flex w-72 flex-col gap-0.5 rounded-lg border border-line bg-surface p-3 transition-transform hover:scale-[1.02]"
          style={{ boxShadow: "0 8px 30px rgba(0,0,0,0.04)" }}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-pastel-blue-ink">Pengajuan baru</p>
          <p className="text-sm font-medium text-ink">{n.applicantName}</p>
          <p className="text-xs text-ink-muted">
            {n.serviceLabel} &middot; {n.ticketNumber}
          </p>
        </Link>
      ))}
    </div>
  );
}
