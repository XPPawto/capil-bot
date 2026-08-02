"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface MessageItem {
  id: number;
  direction: "OUTBOUND" | "INBOUND";
  message: string;
  createdAt: string;
  adminName: string | null;
}

export function MessageThread({ requestId, messages }: { requestId: string; messages: MessageItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    const res = await fetch(`/api/requests/${requestId}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: trimmed }),
    });
    setSending(false);
    if (!res.ok) {
      setError("Gagal mengirim pesan (bot mungkin sedang offline). Coba lagi.");
      return;
    }
    setText("");
    startTransition(() => router.refresh());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
        {messages.length === 0 && <p className="text-sm text-ink-muted">Belum ada percakapan.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.direction === "OUTBOUND" ? "items-end" : "items-start"}`}>
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.direction === "OUTBOUND" ? "bg-ink text-white" : "bg-canvas text-ink"
              }`}
            >
              {m.message}
            </div>
            <span className="mt-1 text-[11px] text-ink-muted">
              {m.direction === "OUTBOUND" ? (m.adminName ?? "Petugas") : "Warga"} &middot;{" "}
              {new Date(m.createdAt).toLocaleString("id-ID")}
            </span>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-pastel-red-ink">{error}</p>}

      <div className="flex gap-2 border-t border-line pt-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ketik pesan untuk warga... (Enter untuk kirim)"
          rows={2}
          className="flex-1 resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink"
        />
        <button
          onClick={handleSend}
          disabled={sending || !text.trim()}
          className="self-end rounded-md bg-ink px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#333333] disabled:opacity-50"
        >
          Kirim
        </button>
      </div>
    </div>
  );
}
