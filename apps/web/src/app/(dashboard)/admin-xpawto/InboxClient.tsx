"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { relativeDuration } from "@/lib/format";
import { IconChat, IconSearch } from "@/components/icons";

interface Conversation {
  waJid: string;
  waNumber: string;
  lastMessage: string;
  lastDirection: "INBOUND" | "OUTBOUND";
  lastAt: string;
  takeoverActive: boolean;
}

interface MessageItem {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  message: string;
  createdAt: string;
  adminName: string | null;
}

const LIST_POLL_MS = 6000;
const THREAD_POLL_MS = 3000;

function initialsOf(waNumber: string): string {
  return waNumber.slice(-2);
}

function formatPhone(waNumber: string): string {
  // Tampilkan sedikit lebih enak dibaca: 6281234567890 -> +62 812-3456-7890 (best-effort,
  // tidak mengubah data asli, cuma tampilan).
  const digits = waNumber.replace(/\D/g, "");
  if (digits.startsWith("62") && digits.length >= 10) {
    const rest = digits.slice(2);
    return `+62 ${rest.slice(0, 3)}-${rest.slice(3, 7)}-${rest.slice(7)}`;
  }
  return `+${digits}`;
}

export function InboxClient({ initialConversations }: { initialConversations: Conversation[] }) {
  const [conversations, setConversations] = useState(initialConversations);
  const [query, setQuery] = useState("");
  const [selectedWaJid, setSelectedWaJid] = useState<string | null>(initialConversations[0]?.waJid ?? null);
  const [showThreadOnMobile, setShowThreadOnMobile] = useState(false);

  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingTakeover, setTogglingTakeover] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const latestCreatedAtRef = useRef<string | undefined>(undefined);

  const selected = useMemo(
    () => conversations.find((c) => c.waJid === selectedWaJid) ?? null,
    [conversations, selectedWaJid]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) => c.waNumber.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q)
    );
  }, [conversations, query]);

  // ---- poll daftar percakapan ----
  const pollList = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox", { cache: "no-store" });
      if (!res.ok) return;
      const data: { conversations: Conversation[] } = await res.json();
      setConversations(data.conversations);
    } catch {
      // koneksi gagal sesaat, dicoba lagi di siklus berikutnya
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(pollList, LIST_POLL_MS);
    return () => clearInterval(interval);
  }, [pollList]);

  // ---- muat & poll thread yang sedang dipilih ----
  const pollThread = useCallback(async (waJid: string, since?: string) => {
    try {
      const url = new URL(`/api/inbox/${encodeURIComponent(waJid)}/messages`, window.location.origin);
      if (since) url.searchParams.set("since", since);
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      const data: { messages: MessageItem[] } = await res.json();
      return data.messages;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!selectedWaJid) return;
    let cancelled = false;
    latestCreatedAtRef.current = undefined;
    setThreadLoading(true);
    setError(null);

    (async () => {
      const fresh = await pollThread(selectedWaJid);
      if (cancelled || !fresh) return;
      setMessages(fresh);
      latestCreatedAtRef.current = fresh.at(-1)?.createdAt;
      setThreadLoading(false);
    })();

    const interval = setInterval(async () => {
      const fresh = await pollThread(selectedWaJid, latestCreatedAtRef.current);
      if (cancelled || !fresh || fresh.length === 0) return;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const next = fresh.filter((m) => !seen.has(m.id));
        return next.length === 0 ? prev : [...prev, ...next];
      });
      latestCreatedAtRef.current = fresh.at(-1)?.createdAt ?? latestCreatedAtRef.current;
    }, THREAD_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedWaJid, pollThread]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function selectConversation(waJid: string) {
    setSelectedWaJid(waJid);
    setShowThreadOnMobile(true);
    setError(null);
  }

  async function handleToggleTakeover() {
    if (!selected) return;
    setTogglingTakeover(true);
    const next = !selected.takeoverActive;
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(selected.waJid)}/takeover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      if (!res.ok) {
        setError("Gagal mengubah mode percakapan. Coba lagi.");
        return;
      }
      setConversations((prev) => prev.map((c) => (c.waJid === selected.waJid ? { ...c, takeoverActive: next } : c)));
    } catch {
      setError("Gagal mengubah mode percakapan: koneksi ke server terputus.");
    } finally {
      setTogglingTakeover(false);
    }
  }

  async function handleSend() {
    if (!selected) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(selected.waJid)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error === "takeover_required"
            ? 'Aktifkan "Ambil Alih" dulu sebelum membalas.'
            : "Gagal mengirim pesan. Coba lagi."
        );
        return;
      }
      setText("");
      const fresh = await pollThread(selected.waJid, latestCreatedAtRef.current);
      if (fresh && fresh.length > 0) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const next = fresh.filter((m) => !seen.has(m.id));
          return next.length === 0 ? prev : [...prev, ...next];
        });
        latestCreatedAtRef.current = fresh.at(-1)?.createdAt ?? latestCreatedAtRef.current;
      }
    } catch {
      setError("Gagal mengirim pesan: koneksi ke server terputus.");
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
    <div className="flex h-[calc(100vh-7.5rem)] min-h-[520px] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm md:flex-row">
      {/* ---------- Panel kiri: daftar percakapan ---------- */}
      <div
        className={`flex w-full shrink-0 flex-col border-line md:w-[320px] md:border-r ${
          showThreadOnMobile ? "hidden md:flex" : "flex"
        }`}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
          <div>
            <h1 className="font-serif text-lg italic tracking-tight text-ink">Pesan Masuk</h1>
            <p className="text-[11px] text-ink-muted">{conversations.length} percakapan</p>
          </div>
        </div>
        <div className="border-b border-line px-3 py-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-1.5">
            <IconSearch className="h-4 w-4 shrink-0 text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nomor atau pesan..."
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
              <IconChat className="h-8 w-8 text-ink-faint" />
              <p className="text-sm text-ink-muted">
                {conversations.length === 0 ? "Belum ada yang chat bot." : "Tidak ada yang cocok."}
              </p>
            </div>
          )}
          {filtered.map((c) => {
            const active = c.waJid === selectedWaJid;
            const needsReply = c.lastDirection === "INBOUND";
            return (
              <button
                key={c.waJid}
                type="button"
                onClick={() => selectConversation(c.waJid)}
                className={`flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left transition-colors ${
                  active ? "bg-pastel-blue" : "hover:bg-surface-hover"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    active ? "bg-surface text-pastel-blue-ink" : "bg-canvas text-ink-muted"
                  }`}
                >
                  {initialsOf(c.waNumber)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={`truncate font-mono text-[13px] font-medium ${
                        active ? "text-pastel-blue-ink" : "text-ink"
                      }`}
                    >
                      {formatPhone(c.waNumber)}
                    </span>
                    <span className={`shrink-0 text-[10.5px] ${active ? "text-pastel-blue-ink/70" : "text-ink-faint"}`}>
                      {relativeDuration(c.lastAt)}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    {needsReply && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-pastel-blue-ink" />}
                    <span
                      className={`truncate text-xs ${
                        active ? "text-pastel-blue-ink/80" : needsReply ? "text-ink" : "text-ink-muted"
                      }`}
                    >
                      {c.lastDirection === "OUTBOUND" ? "Anda: " : ""}
                      {c.lastMessage}
                    </span>
                  </span>
                  {c.takeoverActive && (
                    <span className="mt-1 inline-flex items-center rounded-full bg-pastel-yellow px-2 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-pastel-yellow-ink">
                      Diambil alih
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------- Panel kanan: thread percakapan ---------- */}
      <div className={`flex min-w-0 flex-1 flex-col ${showThreadOnMobile ? "flex" : "hidden md:flex"}`}>
        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-canvas">
              <IconChat className="h-6 w-6 text-ink-faint" />
            </span>
            <p className="max-w-xs text-sm text-ink-muted">
              Pilih percakapan di sebelah kiri untuk melihat isi pesan dan membalas.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
              <button
                type="button"
                onClick={() => setShowThreadOnMobile(false)}
                className="text-sm text-ink-muted hover:text-ink md:hidden"
                aria-label="Kembali ke daftar"
              >
                &larr;
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-semibold text-ink-muted">
                  {initialsOf(selected.waNumber)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-medium text-ink">{formatPhone(selected.waNumber)}</p>
                  <p className="text-[11px] text-ink-muted">
                    {selected.takeoverActive ? "Anda sedang mengambil alih" : "Bot menjawab otomatis"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleToggleTakeover}
                disabled={togglingTakeover}
                className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                  selected.takeoverActive
                    ? "bg-ink text-canvas hover:opacity-90"
                    : "border border-line text-ink hover:bg-surface-hover"
                }`}
              >
                {togglingTakeover ? "Memproses..." : selected.takeoverActive ? "Lepas" : "Ambil Alih"}
              </button>
            </div>

            <div ref={scrollRef} className="flex flex-1 flex-col gap-2.5 overflow-y-auto bg-canvas px-5 py-4">
              {threadLoading && <p className="text-center text-xs text-ink-faint">Memuat percakapan...</p>}
              {!threadLoading && messages.length === 0 && (
                <p className="text-center text-xs text-ink-faint">Belum ada pesan.</p>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`flex flex-col ${m.direction === "OUTBOUND" ? "items-end" : "items-start"}`}>
                  <div
                    className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                      m.direction === "OUTBOUND"
                        ? "rounded-tr-sm bg-ink text-canvas"
                        : "rounded-tl-sm border border-line bg-surface text-ink"
                    }`}
                  >
                    {m.message}
                  </div>
                  <span className="mt-1 text-[10.5px] text-ink-faint">
                    {m.direction === "OUTBOUND" ? (m.adminName ?? "Petugas") : "Warga"} &middot;{" "}
                    {new Date(m.createdAt).toLocaleString("id-ID")}
                  </span>
                </div>
              ))}
            </div>

            {error && <p className="border-t border-line px-5 py-2 text-xs text-pastel-red-ink">{error}</p>}
            {!selected.takeoverActive && !error && (
              <p className="border-t border-line px-5 py-2 text-xs text-ink-muted">
                Aktifkan &quot;Ambil Alih&quot; untuk membalas pesan ini secara manual.
              </p>
            )}

            <div className="flex gap-2 border-t border-line px-4 py-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!selected.takeoverActive}
                placeholder={selected.takeoverActive ? "Ketik balasan... (Enter untuk kirim)" : "Ambil alih dulu untuk membalas"}
                rows={1}
                className="flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-faint"
              />
              <button
                onClick={handleSend}
                disabled={!selected.takeoverActive || sending || !text.trim()}
                className="shrink-0 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-canvas transition-colors hover:opacity-90 disabled:opacity-50"
              >
                Kirim
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
