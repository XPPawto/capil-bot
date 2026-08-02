"use client";

import { useRef, useState } from "react";

export function SendFileForm({ requestId }: { requestId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSend() {
    if (!file) return;
    setSending(true);
    setError(null);
    setSuccess(null);

    const form = new FormData();
    form.append("file", file);

    const res = await fetch(`/api/requests/${requestId}/send-file`, { method: "POST", body: form });
    setSending(false);

    if (!res.ok) {
      setError("Gagal mengirim dokumen (pastikan bot terhubung dan format file JPG/PNG/PDF, maks 10MB).");
      return;
    }
    setSuccess(`Dokumen "${file.name}" terkirim ke warga lewat WhatsApp.`);
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div>
        <h2 className="text-sm font-medium text-ink">Kirim Dokumen ke Warga</h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          Kirim soft file (mis. hasil scan dokumen final) langsung ke WhatsApp warga. Format JPG/PNG/PDF, maks 10MB.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
            setSuccess(null);
          }}
          className="flex-1 text-sm text-ink-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-canvas file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-surface-hover"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!file || sending}
          className="shrink-0 rounded-md bg-ink px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#333333] disabled:opacity-50"
        >
          {sending ? "Mengirim..." : "Kirim"}
        </button>
      </div>

      {error && <p className="text-sm text-pastel-red-ink">{error}</p>}
      {success && <p className="text-sm text-pastel-green-ink">{success}</p>}
    </div>
  );
}
