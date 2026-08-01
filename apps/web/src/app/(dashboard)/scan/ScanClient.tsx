"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

type ValidationResult =
  | {
      valid: true;
      request: { id: string; ticketNumber: string; applicantName: string; serviceLabel: string; waNumber: string };
    }
  | { valid: false; reason: string };

const SCANNER_ELEMENT_ID = "qr-scanner-region";

export function ScanClient() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const busyRef = useRef(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        (decodedText) => {
          void handleDecoded(decodedText);
        },
        () => {
          // dipanggil tiap frame yang gagal decode - diabaikan
        }
      )
      .catch((err) => setCameraError(String(err)));

    return () => {
      scanner.stop().catch(() => undefined);
    };
  }, []);

  async function handleDecoded(token: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await scannerRef.current?.pause(true);
    } catch {
      // scanner mungkin sudah berhenti, aman diabaikan
    }
    setConfirmed(false);

    try {
      const res = await fetch("/api/pickup/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
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
    }
  }

  function handleScanAgain() {
    setResult(null);
    setConfirmed(false);
    try {
      scannerRef.current?.resume();
    } catch {
      // biarkan
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        id={SCANNER_ELEMENT_ID}
        className="mx-auto w-full max-w-sm overflow-hidden rounded-lg border border-neutral-200"
      />

      {cameraError && (
        <p className="mx-auto w-full max-w-sm rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Tidak bisa mengakses kamera: {cameraError}
        </p>
      )}

      {result && (
        <div
          className={`mx-auto w-full max-w-sm rounded-lg border p-4 ${
            result.valid ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
          }`}
        >
          {result.valid ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-green-800">QR Valid</p>
              <p className="text-sm text-neutral-700">No. Tiket: {result.request.ticketNumber}</p>
              <p className="text-sm text-neutral-700">Nama: {result.request.applicantName}</p>
              <p className="text-sm text-neutral-700">Layanan: {result.request.serviceLabel}</p>
              <p className="text-sm text-neutral-700">Nomor WA: {result.request.waNumber}</p>
              <p className="mt-2 text-sm font-medium text-green-700">
                {confirmed ? "Selesai - pengambilan otomatis terkonfirmasi." : busy ? "Memproses..." : "Gagal mengonfirmasi otomatis."}
              </p>
            </div>
          ) : (
            <p className="text-sm font-semibold text-red-700">QR Tidak Valid: {result.reason}</p>
          )}
          <button onClick={handleScanAgain} className="mt-3 text-sm text-neutral-500 hover:underline">
            Scan lagi
          </button>
        </div>
      )}
    </div>
  );
}
