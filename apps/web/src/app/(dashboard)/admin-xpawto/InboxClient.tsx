"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { relativeDuration } from "@/lib/format";
import { IconChat, IconDocument, IconPaperclip, IconSearch, IconUsers } from "@/components/icons";

type Channel = "SERVICE" | "SECONDARY";

interface Conversation {
  waJid: string;
  waNumber: string;
  lastMessage: string;
  lastDirection: "INBOUND" | "OUTBOUND";
  lastAt: string;
  takeoverActive: boolean;
  isGroup: boolean;
  groupName: string | null;
  lastSenderName: string | null;
}

interface MessageItem {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  message: string;
  createdAt: string;
  adminName: string | null;
  attachmentUrl: string | null;
  attachmentMimeType: string | null;
  senderName: string | null;
  senderNumber: string | null;
}

interface AccountStatus {
  connected: boolean;
  isConnecting: boolean;
  waJid: string | null;
  phoneNumber: string | null;
  lastConnectedAt: string | null;
  qrDataUrl: string | null;
  pairingCode: string | null;
  offline?: boolean;
}

const LIST_POLL_MS = 6000;
const THREAD_POLL_MS = 3000;
const STATUS_POLL_MS = 2500;

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
  const [channel, setChannel] = useState<Channel>("SERVICE");
  const [conversations, setConversations] = useState(initialConversations);
  const [query, setQuery] = useState("");
  const [selectedWaJid, setSelectedWaJid] = useState<string | null>(initialConversations[0]?.waJid ?? null);
  const [showThreadOnMobile, setShowThreadOnMobile] = useState(false);

  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendingFile, setSendingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingTakeover, setTogglingTakeover] = useState(false);

  // ---- akun kedua: status koneksi + form sambungkan ----
  const [secondaryStatus, setSecondaryStatus] = useState<AccountStatus | null>(null);
  const [connectTab, setConnectTab] = useState<"qr" | "pairing">("qr");
  const [phoneNumberInput, setPhoneNumberInput] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const secondaryReady = channel === "SERVICE" || Boolean(secondaryStatus?.connected);

  // ---- poll daftar percakapan (channel-aware) ----
  const pollList = useCallback(async (ch: Channel) => {
    try {
      const res = await fetch(`/api/inbox?channel=${ch}`, { cache: "no-store" });
      if (!res.ok) return;
      const data: { conversations: Conversation[] } = await res.json();
      setConversations(data.conversations);
    } catch {
      // koneksi gagal sesaat, dicoba lagi di siklus berikutnya
    }
  }, []);

  // Ganti tab akun: reset seleksi & muat ulang daftar percakapan channel yang baru.
  useEffect(() => {
    setSelectedWaJid(null);
    setShowThreadOnMobile(false);
    setMessages([]);
    setError(null);
    if (channel === "SERVICE") {
      pollList("SERVICE");
    }
  }, [channel, pollList]);

  useEffect(() => {
    if (!secondaryReady) return;
    const interval = setInterval(() => pollList(channel), LIST_POLL_MS);
    return () => clearInterval(interval);
  }, [pollList, channel, secondaryReady]);

  // ---- status koneksi akun kedua (cuma dipoll selagi tab akun kedua aktif) ----
  const fetchSecondaryStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/secondary-account/status", { cache: "no-store" });
      const data: AccountStatus = await res.json();
      setSecondaryStatus(data);
    } catch {
      setSecondaryStatus({
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
  }, []);

  useEffect(() => {
    if (channel !== "SECONDARY") return;
    fetchSecondaryStatus();
    const interval = setInterval(fetchSecondaryStatus, STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [channel, fetchSecondaryStatus]);

  // Begitu akun kedua baru saja tersambung, langsung muat daftar percakapannya.
  useEffect(() => {
    if (channel === "SECONDARY" && secondaryStatus?.connected) {
      pollList("SECONDARY");
    }
  }, [channel, secondaryStatus?.connected, pollList]);

  // ---- muat & poll thread yang sedang dipilih ----
  const pollThread = useCallback(async (waJid: string, ch: Channel, since?: string) => {
    try {
      const url = new URL(`/api/inbox/${encodeURIComponent(waJid)}/messages`, window.location.origin);
      url.searchParams.set("channel", ch);
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
      const fresh = await pollThread(selectedWaJid, channel);
      if (cancelled || !fresh) return;
      setMessages(fresh);
      latestCreatedAtRef.current = fresh.at(-1)?.createdAt;
      setThreadLoading(false);
    })();

    const interval = setInterval(async () => {
      const fresh = await pollThread(selectedWaJid, channel, latestCreatedAtRef.current);
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
  }, [selectedWaJid, channel, pollThread]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function selectConversation(waJid: string) {
    setSelectedWaJid(waJid);
    setShowThreadOnMobile(true);
    setError(null);
  }

  async function handleToggleTakeover() {
    if (!selected || channel !== "SERVICE") return;
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
        body: JSON.stringify({ message: trimmed, channel }),
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
      const fresh = await pollThread(selected.waJid, channel, latestCreatedAtRef.current);
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

  async function handleSendFile(file: File) {
    if (!selected) return;
    setSendingFile(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("channel", channel);
      const res = await fetch(`/api/inbox/${encodeURIComponent(selected.waJid)}/send-file`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error === "takeover_required"
            ? 'Aktifkan "Ambil Alih" dulu sebelum mengirim file.'
            : "Gagal mengirim file (format JPG/PNG/PDF, maks 10MB)."
        );
        return;
      }
      const fresh = await pollThread(selected.waJid, channel, latestCreatedAtRef.current);
      if (fresh && fresh.length > 0) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const next = fresh.filter((m) => !seen.has(m.id));
          return next.length === 0 ? prev : [...prev, ...next];
        });
        latestCreatedAtRef.current = fresh.at(-1)?.createdAt ?? latestCreatedAtRef.current;
      }
    } catch {
      setError("Gagal mengirim file: koneksi ke server terputus.");
    } finally {
      setSendingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  // ---- sambungkan akun kedua ----
  async function handleConnectQr() {
    setConnectError(null);
    setConnectBusy(true);
    const res = await fetch("/api/inbox/secondary-account/connect-qr", { method: "POST" });
    setConnectBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setConnectError(data.error === "already_connected" ? "Akun sudah terhubung." : "Gagal memulai koneksi.");
      return;
    }
    fetchSecondaryStatus();
  }

  async function handleConnectPairing() {
    setConnectError(null);
    if (!phoneNumberInput.trim()) {
      setConnectError("Nomor WA wajib diisi (contoh: 6281234567890).");
      return;
    }
    setConnectBusy(true);
    const res = await fetch("/api/inbox/secondary-account/connect-pairing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phoneNumberInput }),
    });
    setConnectBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setConnectError(data.error === "already_connected" ? "Akun sudah terhubung." : "Gagal memulai koneksi.");
      return;
    }
    fetchSecondaryStatus();
  }

  async function handleLogoutSecondary() {
    if (!window.confirm("Putuskan akun kedua ini? Perlu disambungkan ulang lewat QR/kode pairing setelahnya.")) {
      return;
    }
    setConnectError(null);
    setConnectBusy(true);
    const res = await fetch("/api/inbox/secondary-account/logout", { method: "POST" });
    setConnectBusy(false);
    if (!res.ok) {
      setConnectError("Gagal memutuskan akun.");
      return;
    }
    fetchSecondaryStatus();
  }

  async function handleCopyCode() {
    if (!secondaryStatus?.pairingCode) return;
    try {
      await navigator.clipboard.writeText(secondaryStatus.pairingCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1500);
    } catch {
      // clipboard tidak tersedia - kode tetap terlihat untuk disalin manual
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
        <div className="border-b border-line px-4 py-3.5">
          <h1 className="font-serif text-lg italic tracking-tight text-ink">Pesan Masuk</h1>
          <div className="mt-2.5 flex w-fit gap-1 rounded-full border border-line bg-canvas p-1">
            <button
              type="button"
              onClick={() => setChannel("SERVICE")}
              className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                channel === "SERVICE" ? "bg-ink text-canvas" : "text-ink-muted hover:bg-surface-hover"
              }`}
            >
              Bot Layanan
            </button>
            <button
              type="button"
              onClick={() => setChannel("SECONDARY")}
              className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                channel === "SECONDARY" ? "bg-ink text-canvas" : "text-ink-muted hover:bg-surface-hover"
              }`}
            >
              Akun Kedua
            </button>
          </div>
          {secondaryReady && <p className="mt-2 text-[11px] text-ink-muted">{conversations.length} percakapan</p>}
        </div>

        {!secondaryReady ? (
          <div className="flex flex-1 items-center justify-center px-6 py-10">
            <p className="text-sm text-ink-muted">Belum tersambung.</p>
          </div>
        ) : (
          <>
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
                    {conversations.length === 0 ? "Belum ada yang chat." : "Tidak ada yang cocok."}
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
                      {c.isGroup ? <IconUsers className="h-4 w-4" /> : initialsOf(c.waNumber)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={`truncate text-[13px] font-medium ${c.isGroup ? "" : "font-mono"} ${
                            active ? "text-pastel-blue-ink" : "text-ink"
                          }`}
                        >
                          {c.isGroup ? (c.groupName ?? "Grup") : formatPhone(c.waNumber)}
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
                          {c.lastDirection === "OUTBOUND" ? "Anda: " : c.isGroup && c.lastSenderName ? `${c.lastSenderName}: ` : ""}
                          {c.lastMessage}
                        </span>
                      </span>
                      {channel === "SERVICE" && c.takeoverActive && (
                        <span className="mt-1 inline-flex items-center rounded-full bg-pastel-yellow px-2 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-pastel-yellow-ink">
                          Diambil alih
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ---------- Panel kanan: thread percakapan, atau layar sambungkan akun kedua ---------- */}
      <div className={`flex min-w-0 flex-1 flex-col ${showThreadOnMobile ? "flex" : "hidden md:flex"}`}>
        {!secondaryReady ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
            {secondaryStatus?.offline ? (
              <p className="max-w-xs rounded-lg bg-pastel-red px-4 py-3 text-sm text-pastel-red-ink">
                Proses bot tidak dapat dihubungi. Pastikan proses bot (apps/bot) sedang aktif.
              </p>
            ) : !secondaryStatus ? (
              <p className="text-sm text-ink-muted">Memuat status akun kedua...</p>
            ) : (
              <div className="flex w-full max-w-xs flex-col items-center gap-4">
                <div>
                  <h2 className="font-serif text-lg italic tracking-tight text-ink">Sambungkan Akun Kedua</h2>
                  <p className="mt-1 text-xs text-ink-muted">
                    Nomor terpisah dari bot layanan, murni perangkat tertaut manual - tidak ada balasan otomatis.
                  </p>
                </div>

                <div className="flex w-fit gap-1.5 rounded-full border border-line bg-canvas p-1">
                  <button
                    onClick={() => setConnectTab("qr")}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      connectTab === "qr" ? "bg-ink text-canvas" : "text-ink-muted hover:bg-surface-hover"
                    }`}
                  >
                    QR Code
                  </button>
                  <button
                    onClick={() => setConnectTab("pairing")}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      connectTab === "pairing" ? "bg-ink text-canvas" : "text-ink-muted hover:bg-surface-hover"
                    }`}
                  >
                    Kode Pairing
                  </button>
                </div>

                {connectError && (
                  <p className="w-full rounded-md bg-pastel-red px-3 py-2 text-xs text-pastel-red-ink">{connectError}</p>
                )}

                {connectTab === "qr" ? (
                  <div className="flex w-full flex-col items-center gap-3">
                    <button
                      disabled={connectBusy}
                      onClick={handleConnectQr}
                      className="rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-canvas transition-colors hover:opacity-90 disabled:opacity-50"
                    >
                      Mulai Sambungkan via QR
                    </button>
                    {secondaryStatus.isConnecting && !secondaryStatus.qrDataUrl && (
                      <p className="text-xs text-ink-muted">Menyiapkan QR...</p>
                    )}
                    {secondaryStatus.qrDataUrl && (
                      <div className="rounded-xl border border-line bg-canvas p-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={secondaryStatus.qrDataUrl} alt="QR akun kedua" width={220} height={220} />
                        <p className="mt-2 max-w-56 text-[11px] text-ink-muted">
                          Buka WhatsApp di HP nomor kedua &gt; Perangkat Tertaut &gt; Tautkan Perangkat, lalu scan QR ini.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex w-full flex-col items-center gap-3">
                    <div className="flex w-full gap-2">
                      <input
                        value={phoneNumberInput}
                        onChange={(e) => setPhoneNumberInput(e.target.value)}
                        placeholder="Contoh: 6281234567890"
                        className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink"
                      />
                      <button
                        disabled={connectBusy}
                        onClick={handleConnectPairing}
                        className="shrink-0 rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-canvas transition-colors hover:opacity-90 disabled:opacity-50"
                      >
                        Kirim
                      </button>
                    </div>
                    {secondaryStatus.isConnecting && !secondaryStatus.pairingCode && (
                      <p className="text-xs text-ink-muted">Membuat kode pairing...</p>
                    )}
                    {secondaryStatus.pairingCode && (
                      <div className="rounded-xl border border-line bg-canvas p-4">
                        <div className="flex items-center gap-3">
                          <p className="font-mono text-xl font-semibold tracking-widest text-ink">
                            {secondaryStatus.pairingCode}
                          </p>
                          <button
                            onClick={handleCopyCode}
                            className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-muted transition-colors hover:bg-surface-hover"
                          >
                            {copiedCode ? "Tersalin" : "Salin"}
                          </button>
                        </div>
                        <p className="mt-2 max-w-56 text-[11px] text-ink-muted">
                          Masukkan kode ini di WhatsApp &gt; Perangkat Tertaut &gt; Tautkan dengan nomor telepon.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : !selected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-canvas">
              <IconChat className="h-6 w-6 text-ink-faint" />
            </span>
            <p className="max-w-xs text-sm text-ink-muted">
              Pilih percakapan di sebelah kiri untuk melihat isi pesan dan membalas.
            </p>
            {channel === "SECONDARY" && secondaryStatus?.phoneNumber && (
              <button
                type="button"
                onClick={handleLogoutSecondary}
                className="text-xs text-pastel-red-ink hover:underline"
              >
                Putuskan akun kedua ({formatPhone(secondaryStatus.phoneNumber)})
              </button>
            )}
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
                  {selected.isGroup ? <IconUsers className="h-4 w-4" /> : initialsOf(selected.waNumber)}
                </span>
                <div className="min-w-0">
                  <p className={`truncate text-sm font-medium text-ink ${selected.isGroup ? "" : "font-mono"}`}>
                    {selected.isGroup ? (selected.groupName ?? "Grup") : formatPhone(selected.waNumber)}
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    {selected.isGroup
                      ? "Grup WA - percakapan manual"
                      : channel === "SECONDARY"
                        ? "Percakapan manual"
                        : selected.takeoverActive
                          ? "Anda sedang mengambil alih"
                          : "Bot menjawab otomatis"}
                  </p>
                </div>
              </div>
              {channel === "SERVICE" && (
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
              )}
            </div>

            <div ref={scrollRef} className="flex flex-1 flex-col gap-2.5 overflow-y-auto bg-canvas px-5 py-4">
              {threadLoading && <p className="text-center text-xs text-ink-faint">Memuat percakapan...</p>}
              {!threadLoading && messages.length === 0 && (
                <p className="text-center text-xs text-ink-faint">Belum ada pesan.</p>
              )}
              {messages.map((m) => {
                const isImage = Boolean(m.attachmentUrl && m.attachmentMimeType?.startsWith("image/"));
                const isOtherFile = Boolean(m.attachmentUrl && !isImage);
                // "[Foto]"/"[Dokumen]" cuma label generik yang dibuat otomatis saat menyimpan
                // lampiran (lihat inboxMedia.ts) - tidak perlu ditampilkan lagi sebagai teks
                // terpisah kalau lampirannya sudah dirender di atasnya.
                const hideGenericLabel = (isImage && m.message === "[Foto]") || (isOtherFile && m.message === "[Dokumen]");
                return (
                  <div key={m.id} className={`flex flex-col ${m.direction === "OUTBOUND" ? "items-end" : "items-start"}`}>
                    <div
                      className={`max-w-[75%] overflow-hidden rounded-2xl text-sm shadow-sm ${
                        m.direction === "OUTBOUND"
                          ? "rounded-tr-sm bg-ink text-canvas"
                          : "rounded-tl-sm border border-line bg-surface text-ink"
                      }`}
                    >
                      {isImage && (
                        <a href={m.attachmentUrl!} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.attachmentUrl!} alt="Lampiran foto" className="block max-h-72 w-full object-cover" />
                        </a>
                      )}
                      {isOtherFile && (
                        <a
                          href={m.attachmentUrl!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-2 px-3.5 py-2.5 underline-offset-2 hover:underline ${
                            m.direction === "OUTBOUND" ? "text-canvas" : "text-ink"
                          }`}
                        >
                          <IconDocument className="h-5 w-5 shrink-0" />
                          <span className="truncate text-xs">Buka lampiran</span>
                        </a>
                      )}
                      {/* Di grup, satu thread berisi banyak pengirim berbeda - beri label nama
                          pengirim supaya jelas siapa yang bicara, beda dari chat 1:1. */}
                      {((selected.isGroup && m.direction === "INBOUND" && m.senderName) || !hideGenericLabel) && (
                        <div className="px-3.5 py-2">
                          {selected.isGroup && m.direction === "INBOUND" && m.senderName && (
                            <p className="text-[11px] font-medium text-pastel-blue-ink">{m.senderName}</p>
                          )}
                          {!hideGenericLabel && <p className="whitespace-pre-wrap">{m.message}</p>}
                        </div>
                      )}
                    </div>
                    <span className="mt-1 text-[10.5px] text-ink-faint">
                      {m.direction === "OUTBOUND"
                        ? (m.adminName ?? (channel === "SECONDARY" ? "Dibalas dari HP" : "Petugas"))
                        : selected.isGroup
                          ? (m.senderName ?? m.senderNumber ?? "Anggota grup")
                          : "Warga"}{" "}
                      &middot; {new Date(m.createdAt).toLocaleString("id-ID")}
                    </span>
                  </div>
                );
              })}
            </div>

            {error && <p className="border-t border-line px-5 py-2 text-xs text-pastel-red-ink">{error}</p>}
            {channel === "SERVICE" && !selected.takeoverActive && !error && (
              <p className="border-t border-line px-5 py-2 text-xs text-ink-muted">
                Aktifkan &quot;Ambil Alih&quot; untuk membalas pesan ini secara manual.
              </p>
            )}

            <div className="flex gap-2 border-t border-line px-4 py-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleSendFile(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!selected.takeoverActive || sendingFile}
                title="Kirim foto/dokumen"
                className="flex shrink-0 items-center justify-center rounded-lg border border-line px-3 text-ink-muted transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconPaperclip className="h-[18px] w-[18px]" />
              </button>
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
