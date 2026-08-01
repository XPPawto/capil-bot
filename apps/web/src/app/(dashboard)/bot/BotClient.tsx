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

  if (!status) {
    return <p className="text-sm text-neutral-500">Memuat status bot...</p>;
  }

  if (status.offline) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        Proses bot tidak berjalan atau tidak dapat dihubungi. Pastikan proses bot (apps/bot) sedang aktif.
      </p>
    );
  }

  if (status.connected) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-800">Terhubung</p>
          <p className="text-sm text-neutral-700">Nomor: {status.phoneNumber ?? "-"}</p>
          {status.lastConnectedAt && (
            <p className="text-xs text-neutral-500">
              Sejak {new Date(status.lastConnectedAt).toLocaleString("id-ID")}
            </p>
          )}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          disabled={busy}
          onClick={handleLogout}
          className="w-fit rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Logout Nomor Bot
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <button
          onClick={() => setTab("qr")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            tab === "qr" ? "bg-neutral-900 text-white" : "border border-neutral-300 text-neutral-700"
          }`}
        >
          QR Code
        </button>
        <button
          onClick={() => setTab("pairing")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            tab === "pairing" ? "bg-neutral-900 text-white" : "border border-neutral-300 text-neutral-700"
          }`}
        >
          Kode Pairing
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {tab === "qr" ? (
        <div className="flex flex-col items-start gap-3">
          <button
            disabled={busy}
            onClick={handleConnectQr}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            Mulai Sambungkan via QR
          </button>
          {status.qrDataUrl && (
            <div className="rounded-lg border border-neutral-200 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={status.qrDataUrl} alt="QR WhatsApp" width={256} height={256} />
              <p className="mt-2 text-xs text-neutral-500">Scan dari WhatsApp &gt; Perangkat Tertaut.</p>
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
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
            <button
              disabled={busy}
              onClick={handleConnectPairing}
              className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              Kirim Kode Pairing
            </button>
          </div>
          {status.pairingCode && (
            <div className="rounded-lg border border-neutral-200 p-4">
              <p className="font-mono text-2xl font-semibold tracking-widest text-neutral-900">
                {status.pairingCode}
              </p>
              <p className="mt-2 text-xs text-neutral-500">
                Masukkan kode ini di WhatsApp &gt; Perangkat Tertaut &gt; Tautkan dengan nomor telepon.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
