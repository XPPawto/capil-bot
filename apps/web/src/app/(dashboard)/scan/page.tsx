import { ScanClient } from "./ScanClient";

export default function ScanPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-3xl italic tracking-tight text-ink">Scan QR Pengambilan</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Arahkan kamera ke QR yang ditunjukkan warga untuk memvalidasi pengambilan dokumen.
        </p>
      </div>
      <ScanClient />
    </div>
  );
}
