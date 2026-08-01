import { ScanClient } from "./ScanClient";

export default function ScanPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Scan QR Pengambilan</h1>
        <p className="text-sm text-neutral-500">
          Arahkan kamera ke QR yang ditunjukkan warga untuk memvalidasi pengambilan dokumen.
        </p>
      </div>
      <ScanClient />
    </div>
  );
}
