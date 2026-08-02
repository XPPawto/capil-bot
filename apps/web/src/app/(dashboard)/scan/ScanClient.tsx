"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

type ValidationResult =
  | {
      valid: true;
      request: { id: string; ticketNumber: string; applicantName: string; serviceLabel: string; waNumber: string };
    }
  | { valid: false; reason: string };

type ScanMode = "camera" | "device";

const SCANNER_ELEMENT_ID = "qr-scanner-region";

export function ScanClient() {
  const [mode, setMode] = useState<ScanMode>("camera");
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const deviceInputRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [manualToken, setManualToken] = useState("");

  // Mode kamera: nyalakan webcam & baca QR lewat gambar.
  useEffect(() => {
    if (mode !== "camera") return;
    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
    scannerRef.current = scanner;
    setCameraReady(false);
    setCameraError(null);

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        (decodedText) => {
          void handleToken(decodedText, { pauseCamera: true });
        },
        () => {
          // dipanggil tiap frame yang gagal decode - diabaikan
        }
      )
      .then(() => setCameraReady(true))
      .catch((err) => setCameraError(String(err)));

    return () => {
      scanner.stop().catch(() => undefined);
      scannerRef.current = null;
    };
  }, [mode]);

  // Mode alat scanner eksternal: kebanyakan scanner USB/Bluetooth "menyamar" jadi
  // keyboard - begitu discan, otomatis mengetik hasilnya + Enter ke kolom yang aktif.
  // Kolom ini harus selalu fokus supaya ketikan dari alat itu benar-benar masuk.
  useEffect(() => {
    if (mode !== "device") return;
    deviceInputRef.current?.focus();
  }, [mode, result]);

  async function handleToken(token: string, opts?: { pauseCamera?: boolean }) {
    if (busyRef.current || !token.trim()) return;
    busyRef.current = true;
    setBusy(true);
    if (opts?.pauseCamera) {
      try {
        await scannerRef.current?.pause(true);
      } catch {
        // scanner mungkin sudah berhenti, aman diabaikan
      }
    }
    setConfirmed(false);

    try {
      const res = await fetch("/api/pickup/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = (await res.json()) as ValidationResult;
      setResult(data);

      // QR valid langsung dianggap sudah diambil - tidak perlu klik konfirmasi manual lagi.
      if (data.valid) {
        const confirmRes = await fetch("/api/pickup/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestId: data.request.id }),
        });
        if (confirmRes.ok) {
          setConfirmed(true);
        }
      }
    } catch {
      setResult({ valid: false, reason: "Gagal menghubungi server." });
    } finally {
      setBusy(false);
      busyRef.current = false;
      setManualToken("");
    }
  }

  function handleScanAgain() {
    setResult(null);
    setConfirmed(false);
    setManualToken("");
    try {
      scannerRef.current?.resume();
    } catch {
      // biarkan
    }
    if (mode === "device") {
      deviceInputRef.current?.focus();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="mx-auto flex w-full max-w-sm gap-1.5 rounded-full border border-line bg-surface p-1">
        {(
          [
            { key: "camera", label: "Kamera" },
            { key: "device", label: "Alat Scanner Eksternal" },
          ] as const
        ).map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => {
              setResult(null);
              setMode(m.key);
            }}
            className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === m.key ? "bg-ink text-white" : "text-ink-muted hover:bg-surface-hover"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "camera" ? (
        <>
          <div className="mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-line bg-surface">
            <div id={SCANNER_ELEMENT_ID} />
            {!cameraReady && !cameraError && (
              <p className="px-4 py-3 text-center text-xs text-ink-muted">Menyalakan kamera...</p>
            )}
          </div>
          {cameraError && (
            <p className="mx-auto w-full max-w-sm rounded-lg bg-pastel-red px-3 py-2 text-sm text-pastel-red-ink">
              Tidak bisa mengakses kamera: {cameraError}. Coba mode &ldquo;Alat Scanner Eksternal&rdquo; atau
              ketik kode manual.
            </p>
          )}
          {!result && (
            <div className="mx-auto flex w-full max-w-sm items-center gap-2">
              <div className="h-px flex-1 bg-line" />
              <span className="text-xs text-ink-muted">atau ketik kode manual</span>
              <div className="h-px flex-1 bg-line" />
            </div>
          )}
          {!result && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleToken(manualToken);
              }}
              className="mx-auto flex w-full max-w-sm gap-2"
            >
              <input
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value.toUpperCase())}
                placeholder="Kode tiket QR"
                className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink"
              />
              <button
                type="submit"
                disabled={busy || !manualToken.trim()}
                className="rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#333333] disabled:opacity-50"
              >
                Cek
              </button>
            </form>
          )}
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleToken(manualToken);
          }}
          className="mx-auto flex w-full max-w-sm flex-col gap-2"
        >
          <label className="text-xs text-ink-muted">
            Klik kolom ini lalu pindai QR dengan alat scanner USB/Bluetooth kantor - hasil akan otomatis masuk
            dan terproses.
          </label>
          <input
            ref={deviceInputRef}
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value.toUpperCase())}
            autoFocus
            placeholder="Siap menerima pindaian..."
            className="rounded-xl border-2 border-dashed border-line bg-surface px-4 py-6 text-center text-lg font-medium tracking-wide text-ink outline-none transition-colors focus:border-ink"
          />
        </form>
      )}

      {result && (
        <div
          className={`mx-auto w-full max-w-sm rounded-xl border p-4 ${
            result.valid ? "border-pastel-green-ink/30 bg-pastel-green" : "border-pastel-red-ink/30 bg-pastel-red"
          }`}
        >
          {result.valid ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-semibold text-pastel-green-ink">QR Valid</p>
              <p className="text-sm text-ink">No. Tiket: {result.request.ticketNumber}</p>
              <p className="text-sm text-ink">Nama: {result.request.applicantName}</p>
              <p className="text-sm text-ink">Layanan: {result.request.serviceLabel}</p>
              <p className="text-sm text-ink">Nomor WA: {result.request.waNumber}</p>
              <p className="mt-2 text-sm font-medium text-pastel-green-ink">
                {confirmed
                  ? "Selesai - pengambilan otomatis terkonfirmasi."
                  : busy
                    ? "Memproses..."
                    : "Gagal mengonfirmasi otomatis."}
              </p>
            </div>
          ) : (
            <p className="text-sm font-semibold text-pastel-red-ink">QR Tidak Valid: {result.reason}</p>
          )}
          <button
            onClick={handleScanAgain}
            className="mt-3 text-sm font-medium text-ink-muted transition-colors hover:text-ink hover:underline"
          >
            Scan lagi
          </button>
        </div>
      )}
    </div>
  );
}
