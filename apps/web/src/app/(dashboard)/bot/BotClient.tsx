"use client";

import { useEffect, useRef, useState } from "react";

interface BotStatus {
  connected: boolean;
  isConnecting: boolean;
  waJid: string | null;
  phoneNumber: string | null;
  lastConnectedAt: string | null;
  qrDataUrl: string | null;
  pairingCode: string | null;
  offline?: boolean;
}

const POLL_MS = 2500;

export function BotClient() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [tab, setTab] = useState<"qr" | "pairing">("qr");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchStatus() {
    try {
      const res = await fetch("/api/bot/status", { cache: "no-store" });
      const data = (await res.json()) as BotStatus;
      setStatus(data);
    } catch {
      setStatus({
        connected: false,
        isConnecting: false,
        waJid: null,
        phoneNumber: null,
        lastConnectedAt: null,
        qrDataUrl: null,
        pairingCode: null,
        offline: true,
      });
    }
  }

  useEffect(() => {
    fetchStatus();
    timerRef.current = setInterval(fetchStatus, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function handleConnectQr() {
    setError(null);
    setBusy(true);
    const res = await fetch("/api/bot/connect-qr", { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error === "already_connected" ? "Bot sudah terhubung." : "Gagal memulai koneksi.");
      return;
    }
    fetchStatus();
  }

  async function handleConnectPairing() {
    setError(null);
    if (!phoneNumber.trim()) {
      setError("Nomor WA wajib diisi (contoh: 6281234567890).");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/bot/connect-pairing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error === "already_connected" ? "Bot sudah terhubung." : "Gagal memulai koneksi.");
      return;
    }
    fetchStatus();
  }

  async function handleLogout() {
    if (!window.confirm("Putuskan nomor WA bot? Warga tidak akan bisa mengirim pesan sampai disambungkan ulang.")) {
      return;
    }
    setError(null);
    setBusy(true);
    const res = await fetch("/api/bot/logout", { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      setError("Gagal logout.");
      return;
    }
    fetchStatus();
  }

  async function handleCopyCode() {
    if (!status?.pairingCode) return;
    try {
      await navigator.clipboard.writeText(status.pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard tidak tersedia (mis. http tanpa TLS) - biarkan, kode tetap terlihat untuk disalin manual
    }
  }

  if (!status) {
    return <p className="text-sm text-ink-muted">Memuat status bot...</p>;
  }

  if (status.offline) {
    return (
      <p className="rounded-lg bg-pastel-red px-4 py-3 text-sm text-pastel-red-ink">
        Proses bot tidak berjalan atau tidak dapat dihubungi. Pastikan proses bot (apps/bot) sedang aktif.
      </p>
    );
  }

  if (status.connected) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-pastel-green-ink/30 bg-pastel-green p-5">
          <p className="flex items-center gap-1.5 text-sm font-medium text-pastel-green-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-pastel-green-ink" />
            Terhubung
          </p>
          <p className="mt-2 text-sm text-ink">Nomor: {status.phoneNumber ?? "-"}</p>
          {status.lastConnectedAt && (
            <p className="mt-0.5 text-xs text-ink-muted">
              Sejak {new Date(status.lastConnectedAt).toLocaleString("id-ID")}
            </p>
          )}
        </div>
        {error && <p className="rounded-md bg-pastel-red px-3 py-2 text-sm text-pastel-red-ink">{error}</p>}
        <button
          disabled={busy}
          onClick={handleLogout}
          className="w-fit rounded-md border border-pastel-red-ink/30 px-3.5 py-2 text-sm font-medium text-pastel-red-ink transition-colors hover:bg-pastel-red disabled:opacity-50"
        >
          Logout Nomor Bot
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex w-fit gap-1.5 rounded-full border border-line bg-surface p-1">
        <button
          onClick={() => setTab("qr")}
          className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
            tab === "qr" ? "bg-ink text-canvas" : "text-ink-muted hover:bg-surface-hover"
          }`}
        >
          QR Code
        </button>
        <button
          onClick={() => setTab("pairing")}
          className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
            tab === "pairing" ? "bg-ink text-canvas" : "text-ink-muted hover:bg-surface-hover"
          }`}
        >
          Kode Pairing
        </button>
      </div>

      {error && <p className="rounded-md bg-pastel-red px-3 py-2 text-sm text-pastel-red-ink">{error}</p>}

      {tab === "qr" ? (
        <div className="flex flex-col items-start gap-3">
          <button
            disabled={busy}
            onClick={handleConnectQr}
            className="rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-canvas transition-colors hover:opacity-90 disabled:opacity-50"
          >
            Mulai Sambungkan via QR
          </button>
          {status.isConnecting && !status.qrDataUrl && (
            <p className="text-sm text-ink-muted">Menyiapkan QR...</p>
          )}
          {status.qrDataUrl && (
            <div className="rounded-xl border border-line bg-surface p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={status.qrDataUrl} alt="QR WhatsApp" width={256} height={256} />
              <p className="mt-2 max-w-64 text-xs text-ink-muted">
                Buka WhatsApp di HP nomor bot &gt; Perangkat Tertaut &gt; Tautkan Perangkat, lalu scan QR ini.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <div className="flex gap-2">
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="Contoh: 6281234567890"
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink"
            />
            <button
              disabled={busy}
              onClick={handleConnectPairing}
              className="rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-canvas transition-colors hover:opacity-90 disabled:opacity-50"
            >
              Kirim Kode Pairing
            </button>
          </div>
          {status.isConnecting && !status.pairingCode && (
            <p className="text-sm text-ink-muted">Membuat kode pairing...</p>
          )}
          {status.pairingCode && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center gap-3">
                <p className="font-mono text-2xl font-semibold tracking-widest text-ink">{status.pairingCode}</p>
                <button
                  onClick={handleCopyCode}
                  className="rounded-md border border-line px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-hover"
                >
                  {copied ? "Tersalin" : "Salin"}
                </button>
              </div>
              <p className="mt-2 max-w-64 text-xs text-ink-muted">
                Masukkan kode ini di WhatsApp &gt; Perangkat Tertaut &gt; Tautkan dengan nomor telepon.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
