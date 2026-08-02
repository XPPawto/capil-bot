"use client";

import { useState } from "react";

interface DocItem {
  id: number;
  requirementName: string;
  mimeType: string;
  ocrNik: string | null;
  ocrRawText: string | null;
}

export function DocumentGallery({ documents }: { documents: DocItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const current = openIndex !== null ? documents[openIndex] : null;

  function showPrev() {
    setOpenIndex((i) => (i === null ? null : (i - 1 + documents.length) % documents.length));
  }
  function showNext() {
    setOpenIndex((i) => (i === null ? null : (i + 1) % documents.length));
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {documents.map((doc, idx) => (
          <button
            key={doc.id}
            type="button"
            onClick={() => setOpenIndex(idx)}
            className="group flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-2 text-left transition-colors hover:border-ink/30"
          >
            <div className="flex h-36 items-center justify-center overflow-hidden rounded-md bg-canvas">
              {doc.mimeType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/files/${doc.id}`} alt={doc.requirementName} className="h-full w-full object-cover" />
              ) : (
                <iframe src={`/api/files/${doc.id}`} title={doc.requirementName} className="h-full w-full" tabIndex={-1} />
              )}
            </div>
            <span className="line-clamp-2 text-xs text-ink-muted transition-colors group-hover:text-ink">
              {doc.requirementName}
            </span>
            {doc.ocrNik ? (
              <span className="inline-flex w-fit items-center rounded-full bg-pastel-blue px-2 py-0.5 font-mono text-[10px] text-pastel-blue-ink">
                NIK terbaca: {doc.ocrNik}
              </span>
            ) : (
              doc.ocrRawText && (
                <span className="inline-flex w-fit items-center rounded-full bg-pastel-yellow px-2 py-0.5 text-[10px] text-pastel-yellow-ink">
                  OCR jalan, NIK tak terbaca jelas
                </span>
              )
            )}
          </button>
        ))}
        {documents.length === 0 && <p className="col-span-full text-sm text-ink-muted">Belum ada berkas.</p>}
      </div>

      {current && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/85 p-4" onClick={() => setOpenIndex(null)}>
          <div className="mb-3 flex items-center justify-between text-white">
            <div>
              <p className="text-sm">{current.requirementName}</p>
              {current.ocrNik && (
                <p className="mt-0.5 font-mono text-xs text-white/70">
                  NIK terbaca (OCR): {current.ocrNik} &middot; mohon verifikasi manual
                </p>
              )}
              {!current.ocrNik && current.ocrRawText && (
                <p className="mt-0.5 max-w-md text-xs text-white/70">
                  OCR tidak menemukan NIK 16 digit yang jelas. Teks mentah terbaca: “
                  {current.ocrRawText.replace(/\s+/g, " ").trim().slice(0, 160)}”
                </p>
              )}
            </div>
            <div className="flex items-center gap-4">
              <a
                href={`/api/files/${current.id}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-xs underline underline-offset-2 hover:text-white/80"
              >
                Buka tab baru
              </a>
              <button
                type="button"
                onClick={() => setOpenIndex(null)}
                className="rounded-full p-1 hover:bg-white/10"
                aria-label="Tutup"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="h-6 w-6">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div className="relative flex flex-1 items-center justify-center overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {documents.length > 1 && (
              <button
                type="button"
                onClick={showPrev}
                className="absolute left-0 z-10 rounded-full p-2 text-white hover:bg-white/10"
                aria-label="Sebelumnya"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            )}
            {current.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/files/${current.id}`}
                alt={current.requirementName}
                className="max-h-full max-w-full rounded-md object-contain"
              />
            ) : (
              <iframe
                src={`/api/files/${current.id}`}
                title={current.requirementName}
                className="h-full w-full rounded-md bg-white"
              />
            )}
            {documents.length > 1 && (
              <button
                type="button"
                onClick={showNext}
                className="absolute right-0 z-10 rounded-full p-2 text-white hover:bg-white/10"
                aria-label="Berikutnya"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
