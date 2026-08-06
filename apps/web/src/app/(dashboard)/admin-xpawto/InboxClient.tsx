"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { relativeDuration } from "@/lib/format";
import { IconChat, IconDocument, IconPaperclip, IconSearch, IconUsers } from "@/components/icons";

type Channel = "SERVICE" | "EXTRA";
/** "SERVICE" = nomor bot layanan; angka = id salah satu akun ekstra (Akun Kedua, Ketiga, dst). */
type AccountKey = "SERVICE" | number;

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
  contactName: string | null;
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

interface ExtraAccountSummary {
  id: number;
  label: string;
  phoneNumber: string | null;
  lastConnectedAt: string | null;
  connected: boolean;
  isConnecting: boolean;
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

interface UnreadCounts {
  service: number;
  extra: Record<number, number>;
}

const LIST_POLL_MS = 6000;
const THREAD_POLL_MS = 3000;
const STATUS_POLL_MS = 2500;
const ACCOUNTS_POLL_MS = 5000;
const UNREAD_POLL_MS = 6000;

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-pastel-red px-1 text-[9.5px] font-semibold leading-none text-pastel-red-ink">
      {count > 99 ? "99+" : count}
    </span>
  );
}

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

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

/** Jadikan URL di dalam teks pesan (mis. link Google Maps dari share lokasi) bisa diklik. */
function linkifyText(text: string, linkClassName: string) {
  // split dengan capturing group menyisipkan bagian yang cocok regex di antara bagian
  // yang tidak - cukup dicek awalannya, tidak pakai .test() lagi (regex ber-flag "g"
  // menyimpan state lastIndex antar panggilan, gampang salah kalau dipanggil berulang).
  const parts = text.split(URL_PATTERN);
  return parts.map((part, i) =>
    part.startsWith("http://") || part.startsWith("https://") ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={`underline underline-offset-2 ${linkClassName}`}>
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export function InboxClient({ initialConversations }: { initialConversations: Conversation[] }) {
  const [accountKey, setAccountKey] = useState<AccountKey>("SERVICE");
  const [extraAccounts, setExtraAccounts] = useState<ExtraAccountSummary[]>([]);
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

  // ---- akun ekstra yang sedang dipilih tapi belum tersambung: status koneksi + form sambungkan ----
  const [extraStatus, setExtraStatus] = useState<AccountStatus | null>(null);
  const [connectTab, setConnectTab] = useState<"qr" | "pairing">("qr");
  const [phoneNumberInput, setPhoneNumberInput] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const [newAccountLabel, setNewAccountLabel] = useState("");
  const [forceReconnectScreen, setForceReconnectScreen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const latestCreatedAtRef = useRef<string | undefined>(undefined);

  const channel: Channel = accountKey === "SERVICE" ? "SERVICE" : "EXTRA";
  const extraAccountId = accountKey === "SERVICE" ? undefined : accountKey;
  const selectedAccountSummary = accountKey === "SERVICE" ? null : extraAccounts.find((a) => a.id === accountKey) ?? null;
  // "Belum pernah tersambung sama sekali" (belum pernah scan QR/pairing) - satu-satunya
  // kondisi yang benar-benar butuh layar sambungkan. Kalau akun PERNAH tersambung tapi
  // SEDANG terputus (mis. logout dari HP, atau nomornya kena batasan WhatsApp), riwayat
  // chat-nya tetap ada di database dan tetap harus bisa dibuka - cuma tidak bisa membalas
  // sampai disambungkan ulang. Jangan pernah menyembunyikan riwayat gara-gara status
  // koneksi saat ini.
  const neverConnected = accountKey !== "SERVICE" && !selectedAccountSummary?.phoneNumber;
  const showConnectScreen = accountKey !== "SERVICE" && (neverConnected || forceReconnectScreen);
  const ready = accountKey === "SERVICE" || !showConnectScreen;
  const isDisconnected = channel === "EXTRA" && selectedAccountSummary != null && !selectedAccountSummary.connected;

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

  // ---- daftar akun ekstra (tab-tab tambahan) - dipoll terus supaya status sambung/putus
  // dan akun baru yang dibuat langsung kelihatan tanpa reload ----
  const pollAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/extra-accounts", { cache: "no-store" });
      if (!res.ok) return;
      const data: { accounts: ExtraAccountSummary[] } = await res.json();
      setExtraAccounts(data.accounts);
    } catch {
      // koneksi gagal sesaat, dicoba lagi di siklus berikutnya
    }
  }, []);

  useEffect(() => {
    pollAccounts();
    const interval = setInterval(pollAccounts, ACCOUNTS_POLL_MS);
    return () => clearInterval(interval);
  }, [pollAccounts]);

  // ---- badge "belum dibalas" per tab akun - dihitung untuk SEMUA akun sekaligus, bukan
  // cuma yang sedang dibuka, supaya tab yang lagi tidak aktif tetap kelihatan butuh dibalas ----
  const [unreadCounts, setUnreadCounts] = useState<UnreadCounts>({ service: 0, extra: {} });
  const pollUnreadCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/unread-counts", { cache: "no-store" });
      if (!res.ok) return;
      const data: UnreadCounts = await res.json();
      setUnreadCounts(data);
    } catch {
      // koneksi gagal sesaat, dicoba lagi di siklus berikutnya
    }
  }, []);

  useEffect(() => {
    pollUnreadCounts();
    const interval = setInterval(pollUnreadCounts, UNREAD_POLL_MS);
    return () => clearInterval(interval);
  }, [pollUnreadCounts]);

  // ---- poll daftar percakapan (akun-aware) ----
  const pollList = useCallback(async (ch: Channel, id: number | undefined) => {
    try {
      const url = new URL("/api/inbox", window.location.origin);
      url.searchParams.set("channel", ch);
      if (id) url.searchParams.set("extraAccountId", String(id));
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const data: { conversations: Conversation[] } = await res.json();
      setConversations(data.conversations);
    } catch {
      // koneksi gagal sesaat, dicoba lagi di siklus berikutnya
    }
  }, []);

  // Ganti tab akun: reset seleksi & muat ulang daftar percakapan akun yang baru.
  useEffect(() => {
    setSelectedWaJid(null);
    setShowThreadOnMobile(false);
    setMessages([]);
    setError(null);
    setConnectError(null);
    setForceReconnectScreen(false);
    if (accountKey === "SERVICE") {
      pollList("SERVICE", undefined);
    }
  }, [accountKey, pollList]);

  useEffect(() => {
    if (!ready) return;
    pollList(channel, extraAccountId);
    const interval = setInterval(() => pollList(channel, extraAccountId), LIST_POLL_MS);
    return () => clearInterval(interval);
  }, [pollList, channel, extraAccountId, ready]);

  // ---- status koneksi akun ekstra yang sedang dipilih (cuma dipoll selagi belum tersambung) ----
  const fetchExtraStatus = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/inbox/extra-accounts/${id}/status`, { cache: "no-store" });
      const data: AccountStatus = await res.json();
      setExtraStatus(data);
    } catch {
      setExtraStatus({
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
    if (accountKey === "SERVICE") {
      setExtraStatus(null);
      return;
    }
    fetchExtraStatus(accountKey);
    const interval = setInterval(() => fetchExtraStatus(accountKey), STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [accountKey, fetchExtraStatus]);

  // ---- muat & poll thread yang sedang dipilih ----
  const pollThread = useCallback(async (waJid: string, ch: Channel, id: number | undefined, since?: string) => {
    try {
      const url = new URL(`/api/inbox/${encodeURIComponent(waJid)}/messages`, window.location.origin);
      url.searchParams.set("channel", ch);
      if (id) url.searchParams.set("extraAccountId", String(id));
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
      const fresh = await pollThread(selectedWaJid, channel, extraAccountId);
      if (cancelled || !fresh) return;
      setMessages(fresh);
      latestCreatedAtRef.current = fresh.at(-1)?.createdAt;
      setThreadLoading(false);
    })();

    const interval = setInterval(async () => {
      const fresh = await pollThread(selectedWaJid, channel, extraAccountId, latestCreatedAtRef.current);
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
  }, [selectedWaJid, channel, extraAccountId, pollThread]);

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
        body: JSON.stringify({ message: trimmed, channel, extraAccountId }),
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
      const fresh = await pollThread(selected.waJid, channel, extraAccountId, latestCreatedAtRef.current);
      if (fresh && fresh.length > 0) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const next = fresh.filter((m) => !seen.has(m.id));
          return next.length === 0 ? prev : [...prev, ...next];
        });
        latestCreatedAtRef.current = fresh.at(-1)?.createdAt ?? latestCreatedAtRef.current;
      }
      pollUnreadCounts();
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
      if (extraAccountId) form.append("extraAccountId", String(extraAccountId));
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
      const fresh = await pollThread(selected.waJid, channel, extraAccountId, latestCreatedAtRef.current);
      if (fresh && fresh.length > 0) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const next = fresh.filter((m) => !seen.has(m.id));
          return next.length === 0 ? prev : [...prev, ...next];
        });
        latestCreatedAtRef.current = fresh.at(-1)?.createdAt ?? latestCreatedAtRef.current;
      }
      pollUnreadCounts();
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

  // ---- tambah akun ekstra baru ----
  async function handleCreateAccount() {
    const label = newAccountLabel.trim();
    if (!label) return;
    setConnectBusy(true);
    setConnectError(null);
    try {
      const res = await fetch("/api/inbox/extra-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) {
        setConnectError("Gagal membuat akun baru.");
        return;
      }
      const account: { id: number; label: string } = await res.json();
      setAddingAccount(false);
      setNewAccountLabel("");
      await pollAccounts();
      setAccountKey(account.id);
    } catch {
      setConnectError("Gagal membuat akun baru: koneksi ke server terputus.");
    } finally {
      setConnectBusy(false);
    }
  }

  // ---- sambungkan akun ekstra yang sedang dipilih ----
  async function handleConnectQr() {
    if (accountKey === "SERVICE") return;
    setConnectError(null);
    setConnectBusy(true);
    const res = await fetch(`/api/inbox/extra-accounts/${accountKey}/connect-qr`, { method: "POST" });
    setConnectBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setConnectError(data.error === "already_connected" ? "Akun sudah terhubung." : "Gagal memulai koneksi.");
      return;
    }
    fetchExtraStatus(accountKey);
  }

  async function handleConnectPairing() {
    if (accountKey === "SERVICE") return;
    setConnectError(null);
    if (!phoneNumberInput.trim()) {
      setConnectError("Nomor WA wajib diisi (contoh: 6281234567890).");
      return;
    }
    setConnectBusy(true);
    const res = await fetch(`/api/inbox/extra-accounts/${accountKey}/connect-pairing`, {
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
    fetchExtraStatus(accountKey);
  }

  async function handleLogoutExtraAccount() {
    if (accountKey === "SERVICE") return;
    if (!window.confirm("Putuskan akun ini? Perlu disambungkan ulang lewat QR/kode pairing setelahnya.")) {
      return;
    }
    setConnectError(null);
    setConnectBusy(true);
    const res = await fetch(`/api/inbox/extra-accounts/${accountKey}/logout`, { method: "POST" });
    setConnectBusy(false);
    if (!res.ok) {
      setConnectError("Gagal memutuskan akun.");
      return;
    }
    fetchExtraStatus(accountKey);
    pollAccounts();
  }

  async function handleDeleteExtraAccount() {
    if (accountKey === "SERVICE") return;
    if (!window.confirm("Hapus akun ini sepenuhnya? Riwayat chat-nya tetap tersimpan, tapi tab-nya akan hilang.")) {
      return;
    }
    const idToDelete = accountKey;
    setConnectBusy(true);
    const res = await fetch(`/api/inbox/extra-accounts/${idToDelete}`, { method: "DELETE" });
    setConnectBusy(false);
    if (!res.ok) {
      setConnectError("Gagal menghapus akun.");
      return;
    }
    setAccountKey("SERVICE");
    pollAccounts();
  }

  async function handleCopyCode() {
    if (!extraStatus?.pairingCode) return;
    try {
      await navigator.clipboard.writeText(extraStatus.pairingCode);
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
          <div className="mt-2.5 flex flex-wrap items-center gap-1 rounded-lg border border-line bg-canvas p-1">
            <button
              type="button"
              onClick={() => setAccountKey("SERVICE")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                accountKey === "SERVICE" ? "bg-ink text-canvas" : "text-ink-muted hover:bg-surface-hover"
              }`}
            >
              Bot Layanan
              <UnreadBadge count={unreadCounts.service} />
            </button>
            {extraAccounts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAccountKey(a.id)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                  accountKey === a.id ? "bg-ink text-canvas" : "text-ink-muted hover:bg-surface-hover"
                }`}
              >
                {a.connected && (
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      accountKey === a.id ? "bg-pastel-green" : "bg-pastel-green-ink"
                    }`}
                  />
                )}
                {a.label}
                <UnreadBadge count={unreadCounts.extra[a.id] ?? 0} />
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setAddingAccount(true);
                setAccountKey("SERVICE");
              }}
              title="Tambah akun"
              className="rounded-full px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-hover"
            >
              +
            </button>
          </div>
          {ready && <p className="mt-2 text-[11px] text-ink-muted">{conversations.length} percakapan</p>}
          {isDisconnected && !addingAccount && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-pastel-yellow px-2.5 py-1.5">
              <p className="text-[10.5px] text-pastel-yellow-ink">
                Akun terputus - riwayat tetap tersimpan.
              </p>
              <button
                type="button"
                onClick={() => setForceReconnectScreen(true)}
                className="shrink-0 text-[10.5px] font-medium text-pastel-yellow-ink underline-offset-2 hover:underline"
              >
                Sambungkan ulang
              </button>
            </div>
          )}
        </div>

        {addingAccount ? (
          <div className="flex flex-1 flex-col gap-3 px-4 py-6">
            <div>
              <h2 className="text-sm font-medium text-ink">Akun baru</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Beri nama supaya mudah dibedakan, mis. &quot;Akun Ketiga&quot; atau nama petugasnya.
              </p>
            </div>
            <input
              value={newAccountLabel}
              onChange={(e) => setNewAccountLabel(e.target.value)}
              placeholder="Contoh: Akun Ketiga"
              autoFocus
              className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink"
            />
            {connectError && <p className="text-xs text-pastel-red-ink">{connectError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCreateAccount}
                disabled={connectBusy || !newAccountLabel.trim()}
                className="rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-canvas transition-colors hover:opacity-90 disabled:opacity-50"
              >
                Buat & Sambungkan
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddingAccount(false);
                  setConnectError(null);
                }}
                className="rounded-md border border-line px-3.5 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-hover"
              >
                Batal
              </button>
            </div>
          </div>
        ) : !ready ? (
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
                          className={`truncate text-[13px] font-medium ${
                            c.isGroup || c.contactName ? "" : "font-mono"
                          } ${active ? "text-pastel-blue-ink" : "text-ink"}`}
                        >
                          {c.isGroup ? (c.groupName ?? "Grup") : (c.contactName ?? formatPhone(c.waNumber))}
                        </span>
                        <span className={`shrink-0 text-[10.5px] ${active ? "text-pastel-blue-ink/70" : "text-ink-faint"}`}>
                          {relativeDuration(c.lastAt)}
                        </span>
                      </span>
                      {!c.isGroup && c.contactName && (
                        <span
                          className={`block truncate font-mono text-[10.5px] ${
                            active ? "text-pastel-blue-ink/70" : "text-ink-faint"
                          }`}
                        >
                          {formatPhone(c.waNumber)}
                        </span>
                      )}
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

      {/* ---------- Panel kanan: thread percakapan, atau layar sambungkan akun ---------- */}
      <div className={`flex min-w-0 flex-1 flex-col ${showThreadOnMobile ? "flex" : "hidden md:flex"}`}>
        {addingAccount ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-canvas">
              <IconUsers className="h-6 w-6 text-ink-faint" />
            </span>
            <p className="max-w-xs text-sm text-ink-muted">Isi nama akun di panel kiri, lalu sambungkan lewat QR/kode pairing.</p>
          </div>
        ) : !ready ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
            {extraStatus?.offline ? (
              <p className="max-w-xs rounded-lg bg-pastel-red px-4 py-3 text-sm text-pastel-red-ink">
                Proses bot tidak dapat dihubungi. Pastikan proses bot (apps/bot) sedang aktif.
              </p>
            ) : !extraStatus ? (
              <p className="text-sm text-ink-muted">Memuat status akun...</p>
            ) : (
              <div className="flex w-full max-w-xs flex-col items-center gap-4">
                <div>
                  <h2 className="font-serif text-lg italic tracking-tight text-ink">
                    {forceReconnectScreen ? "Sambungkan Ulang" : "Sambungkan"} {selectedAccountSummary?.label ?? "Akun"}
                  </h2>
                  <p className="mt-1 text-xs text-ink-muted">
                    Nomor terpisah dari bot layanan, murni perangkat tertaut manual - tidak ada balasan otomatis.
                  </p>
                </div>

                {forceReconnectScreen && !neverConnected && (
                  <button
                    type="button"
                    onClick={() => setForceReconnectScreen(false)}
                    className="text-xs text-ink-muted hover:underline"
                  >
                    &larr; Batal, lihat riwayat chat dulu
                  </button>
                )}

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
                    {extraStatus.isConnecting && !extraStatus.qrDataUrl && (
                      <p className="text-xs text-ink-muted">Menyiapkan QR...</p>
                    )}
                    {extraStatus.qrDataUrl && (
                      <div className="rounded-xl border border-line bg-canvas p-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={extraStatus.qrDataUrl} alt="QR akun" width={220} height={220} />
                        <p className="mt-2 max-w-56 text-[11px] text-ink-muted">
                          Buka WhatsApp di HP akun ini &gt; Perangkat Tertaut &gt; Tautkan Perangkat, lalu scan QR ini.
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
                    {extraStatus.isConnecting && !extraStatus.pairingCode && (
                      <p className="text-xs text-ink-muted">Membuat kode pairing...</p>
                    )}
                    {extraStatus.pairingCode && (
                      <div className="rounded-xl border border-line bg-canvas p-4">
                        <div className="flex items-center gap-3">
                          <p className="font-mono text-xl font-semibold tracking-widest text-ink">
                            {extraStatus.pairingCode}
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

                <button type="button" onClick={handleDeleteExtraAccount} className="text-xs text-pastel-red-ink hover:underline">
                  Hapus akun ini
                </button>
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
            {isDisconnected && selectedAccountSummary?.phoneNumber && (
              <button
                type="button"
                onClick={() => setForceReconnectScreen(true)}
                className="text-xs text-pastel-yellow-ink hover:underline"
              >
                Akun terputus - sambungkan ulang ({formatPhone(selectedAccountSummary.phoneNumber)})
              </button>
            )}
            {channel === "EXTRA" && !isDisconnected && selectedAccountSummary?.phoneNumber && (
              <button type="button" onClick={handleLogoutExtraAccount} className="text-xs text-pastel-red-ink hover:underline">
                Putuskan akun ini ({formatPhone(selectedAccountSummary.phoneNumber)})
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
                  <p
                    className={`truncate text-sm font-medium text-ink ${
                      selected.isGroup || selected.contactName ? "" : "font-mono"
                    }`}
                  >
                    {selected.isGroup ? (selected.groupName ?? "Grup") : (selected.contactName ?? formatPhone(selected.waNumber))}
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    {!selected.isGroup && selected.contactName && (
                      <span className="font-mono">{formatPhone(selected.waNumber)} &middot; </span>
                    )}
                    {selected.isGroup
                      ? "Grup WA - percakapan manual"
                      : channel === "EXTRA"
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
                const isVideo = Boolean(m.attachmentUrl && m.attachmentMimeType?.startsWith("video/"));
                const isOtherFile = Boolean(m.attachmentUrl && !isImage && !isVideo);
                // Stiker tersimpan sebagai image/webp (sama seperti foto) - dibedakan cuma
                // dari labelnya, dirender lebih kecil & tanpa crop (bukan foto persegi panjang).
                const isSticker = isImage && m.message === "[Stiker]";
                // "[Foto]"/"[Video]"/"[Stiker]"/"[Dokumen]" cuma label generik yang dibuat
                // otomatis saat menyimpan lampiran (lihat inboxMedia.ts) - tidak perlu
                // ditampilkan lagi sebagai teks terpisah kalau lampirannya sudah dirender.
                const hideGenericLabel =
                  (isImage && (m.message === "[Foto]" || m.message === "[Stiker]")) ||
                  (isVideo && m.message === "[Video]") ||
                  (isOtherFile && m.message === "[Dokumen]");
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
                          <img
                            src={m.attachmentUrl!}
                            alt={isSticker ? "Stiker" : "Lampiran foto"}
                            className={
                              isSticker
                                ? "block h-32 w-32 object-contain p-1"
                                : "block max-h-72 w-full object-cover"
                            }
                          />
                        </a>
                      )}
                      {isVideo && (
                        <video src={m.attachmentUrl!} controls className="block max-h-72 w-full bg-canvas" />
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
                          {!hideGenericLabel && (
                            <p className="whitespace-pre-wrap">
                              {linkifyText(m.message, m.direction === "OUTBOUND" ? "text-canvas" : "text-pastel-blue-ink")}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="mt-1 text-[10.5px] text-ink-faint">
                      {m.direction === "OUTBOUND"
                        ? (m.adminName ?? (channel === "EXTRA" ? "Dibalas dari HP" : "Petugas"))
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
            {isDisconnected && !error && (
              <p className="border-t border-line px-5 py-2 text-xs text-ink-muted">
                Akun ini sedang terputus - riwayat tetap bisa dibaca, tapi sambungkan ulang dulu untuk membalas.
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
                disabled={!selected.takeoverActive || isDisconnected || sendingFile}
                title="Kirim foto/dokumen"
                className="flex shrink-0 items-center justify-center rounded-lg border border-line px-3 text-ink-muted transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconPaperclip className="h-[18px] w-[18px]" />
              </button>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!selected.takeoverActive || isDisconnected}
                placeholder={
                  isDisconnected
                    ? "Akun terputus - sambungkan ulang untuk membalas"
                    : selected.takeoverActive
                      ? "Ketik balasan... (Enter untuk kirim)"
                      : "Ambil alih dulu untuk membalas"
                }
                rows={1}
                className="flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-faint"
              />
              <button
                onClick={handleSend}
                disabled={!selected.takeoverActive || isDisconnected || sending || !text.trim()}
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
