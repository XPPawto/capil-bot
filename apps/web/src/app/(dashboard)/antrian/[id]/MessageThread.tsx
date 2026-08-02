"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface MessageItem {
  id: number;
  direction: "OUTBOUND" | "INBOUND";
  message: string;
  createdAt: string;
  adminName: string | null;
  hasAudio: boolean;
}

const POLL_MS = 3000;

export function MessageThread({
  requestId,
  messages: initialMessages,
  disabled,
}: {
  requestId: string;
  messages: MessageItem[];
  disabled: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestCreatedAtRef = useRef<string | undefined>(initialMessages.at(-1)?.createdAt);

  const poll = useCallback(async () => {
    try {
      const url = new URL(`/api/requests/${requestId}/message`, window.location.origin);
      if (latestCreatedAtRef.current) url.searchParams.set("since", latestCreatedAtRef.current);
      const res = await fetch(url);
      if (!res.ok) return;
      const data: { messages: MessageItem[] } = await res.json();
      if (data.messages.length === 0) return;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const fresh = data.messages.filter((m) => !seen.has(m.id));
        return fresh.length === 0 ? prev : [...prev, ...fresh];
      });
      latestCreatedAtRef.current = data.messages.at(-1)?.createdAt ?? latestCreatedAtRef.current;
    } catch {
      // koneksi gagal sesaat tidak masalah, dicoba lagi di polling berikutnya
    }
  }, [requestId]);

  useEffect(() => {
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, [poll]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error === "takeover_required"
            ? "Aktifkan \"Ambil Alih Percakapan\" dulu sebelum mengirim pesan manual."
            : "Gagal mengirim pesan (bot mungkin sedang offline). Coba lagi."
        );
        return;
      }
      setText("");
      // Ambil ulang dari server (bukan sisipkan entry optimistic lokal) - baris asli di DB
      // sudah pasti ada di titik ini (POST menunggu penulisan selesai sebelum merespons),
      // jadi tidak akan tabrakan/dobel dengan yang masuk lewat polling berikutnya.
      void poll();
    } catch {
      // fetch bisa throw kalau koneksi putus total (bukan sekadar respons error dari
      // server) - tanpa try/catch ini, pesan gagal terkirim tanpa penjelasan apa pun
      // ke petugas (cuma muncul di console browser) dan tombol Kirim nyangkut disabled.
      setError("Gagal mengirim pesan: koneksi ke server terputus. Periksa koneksi internet Anda dan coba lagi.");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div ref={scrollRef} className="flex max-h-72 flex-col gap-3 overflow-y-auto">
        {messages.length === 0 && <p className="text-sm text-ink-muted">Belum ada percakapan.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.direction === "OUTBOUND" ? "items-end" : "items-start"}`}>
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.direction === "OUTBOUND" ? "bg-ink text-white" : "bg-canvas text-ink"
              }`}
            >
              {m.message}
              {m.hasAudio && (
                <audio controls src={`/api/messages/${m.id}/audio`} className="mt-1.5 h-9 w-56 max-w-full" />
              )}
            </div>
            <span className="mt-1 text-[11px] text-ink-muted">
              {m.direction === "OUTBOUND" ? (m.adminName ?? "Petugas") : "Warga"} &middot;{" "}
              {new Date(m.createdAt).toLocaleString("id-ID")}
            </span>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-pastel-red-ink">{error}</p>}
      {disabled && (
        <p className="text-xs text-ink-muted">
          Petugas wajib mengambil alih percakapan untuk mengirimkan pesan.
        </p>
      )}

      <div className="flex gap-2 border-t border-line pt-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={disabled ? "Aktifkan \"Ambil Alih Percakapan\" untuk mengirim pesan manual" : "Ketik pesan untuk warga... (Enter untuk kirim)"}
          rows={2}
          className="flex-1 resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-muted"
        />
        <button
          onClick={handleSend}
          disabled={disabled || sending || !text.trim()}
          className="self-end rounded-md bg-ink px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#333333] disabled:opacity-50"
        >
          Kirim
        </button>
      </div>
    </div>
  );
}
