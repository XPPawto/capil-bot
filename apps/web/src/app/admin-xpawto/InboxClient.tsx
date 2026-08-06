"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { relativeDuration } from "@/lib/format";
import {
  IconArrowLeft,
  IconChat,
  IconCheck,
  IconCheckAll,
  IconClose,
  IconDocument,
  IconMegaphone,
  IconPaperclip,
  IconSearch,
  IconSend,
  IconShield,
  IconUsers,
  IconViewOnce,
} from "@/components/icons";

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
  isChannel: boolean;
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
  editedAt: string | null;
  status: string | null;
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

interface LedgerReport {
  ok: boolean;
  checkedAt: string;
  chain: { ok: boolean; totalEntries: number; brokenAtId?: number; reason?: string };
  rowMismatches: { inboxMessageId: number; field: string; expected: string | null; actual: string | null }[];
  fileMismatches: { inboxMessageId: number; reason: string }[];
  attachmentsChecked: number;
}

const LIST_POLL_MS = 6000;
const THREAD_POLL_MS = 3000;
const STATUS_POLL_MS = 2500;
const ACCOUNTS_POLL_MS = 5000;
const UNREAD_POLL_MS = 6000;

// Centang status pesan KELUAR - satu abu-abu (SENT, sudah sampai server WA), dua abu-abu
// (DELIVERED, sudah sampai HP lawan bicara), dua biru (READ, sudah dibaca/diputar). null
// berarti belum ada info status sama sekali (mis. pesan lama dari sebelum fitur ini ada, atau
// belum sempat ada event messages.update baru) - sengaja tidak dirender apa-apa, bukan
// ditampilkan sebagai "gagal", supaya tidak menyesatkan.
function MessageStatusTick({ status }: { status: string | null }) {
  if (status === "READ") return <IconCheckAll className="h-3.5 w-3.5 shrink-0 text-pastel-blue-ink" />;
  if (status === "DELIVERED") return <IconCheckAll className="h-3.5 w-3.5 shrink-0 text-ink-faint" />;
  if (status === "SENT") return <IconCheck className="h-3.5 w-3.5 shrink-0 text-ink-faint" />;
  return null;
}

// Badge "Terverifikasi" - bukti kriptografis (bukan sekadar klaim visual) bahwa riwayat Pesan
// Masuk belum diubah di luar jalur resmi aplikasi ini. Klik untuk lihat laporan lengkapnya
// (lib/accessControl.ts & @kelurahan/db/auditLedger.ts untuk mekanisme di baliknya).
function LedgerBadge({ report, loading, onClick }: { report: LedgerReport | null; loading: boolean; onClick: () => void }) {
  if (loading && !report) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] font-medium text-ink-muted transition-colors active:scale-95"
      >
        <IconShield className="h-3 w-3 animate-pulse" />
        Memeriksa...
      </button>
    );
  }
  const ok = report?.ok ?? false;
  return (
    <button
      type="button"
      onClick={onClick}
      title="Lihat laporan verifikasi keaslian riwayat chat"
      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors active:scale-95 ${
        ok ? "border-pastel-green bg-pastel-green text-pastel-green-ink" : "border-pastel-red bg-pastel-red text-pastel-red-ink"
      }`}
    >
      <IconShield className="h-3 w-3" />
      {ok ? "Terverifikasi" : "Bermasalah"}
    </button>
  );
}

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
  // Lihat foto/stiker langsung di halaman (lightbox) - tidak lagi membuka tab baru.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // ---- badge "Terverifikasi" - bukti keaslian riwayat chat (lihat LedgerBadge) ----
  const [ledgerReport, setLedgerReport] = useState<LedgerReport | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [showLedgerModal, setShowLedgerModal] = useState(false);

  const runLedgerVerification = useCallback(async () => {
    setLedgerLoading(true);
    try {
      const res = await fetch("/api/inbox/verify-ledger");
      if (res.ok) {
        const data: LedgerReport = await res.json();
        setLedgerReport(data);
      }
    } catch {
      // ditinggalkan diam - badge tetap menampilkan hasil terakhir yang berhasil (kalau ada)
    } finally {
      setLedgerLoading(false);
    }
  }, []);

  // Diperiksa otomatis sekali saat halaman dibuka, supaya badge-nya langsung berarti tanpa
  // perlu klik dulu - re-verifikasi penuh tetap tersedia manual dari dalam modal laporannya.
  useEffect(() => {
    runLedgerVerification();
  }, [runLedgerVerification]);

  function downloadLedgerReport() {
    if (!ledgerReport) return;
    const blob = new Blob([JSON.stringify(ledgerReport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `laporan-verifikasi-${ledgerReport.checkedAt.replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    if (!lightboxUrl) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxUrl(null);
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [lightboxUrl]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const latestCreatedAtRef = useRef<string | undefined>(undefined);

  // ---- swipe-untuk-kembali di HP: geser dari kiri ke kanan di panel thread untuk balik
  // ke daftar percakapan, sama seperti aplikasi chat native (bukan cuma tombol "<-") ----
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [swipeOffsetPx, setSwipeOffsetPx] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  function handleThreadTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    setIsSwiping(false);
  }

  function handleThreadTouchMove(e: React.TouchEvent) {
    if (!touchStartRef.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    // Cuma dianggap swipe horizontal kalau condong ke kanan dan lebih mendatar daripada
    // vertikal - supaya scroll biasa (naik/turun baca chat) tidak salah kepicu jadi swipe.
    if (dx > 12 && Math.abs(dx) > Math.abs(dy)) {
      setIsSwiping(true);
      setSwipeOffsetPx(Math.min(dx, 200));
    }
  }

  function handleThreadTouchEnd() {
    if (isSwiping && swipeOffsetPx > 70) {
      setShowThreadOnMobile(false);
    }
    setIsSwiping(false);
    setSwipeOffsetPx(0);
    touchStartRef.current = null;
  }

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
            : "Gagal mengirim file (format foto/video/voice note/PDF, maks 16MB)."
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
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-canvas md:flex-row">
      {/* ---------- Panel kiri: daftar percakapan ---------- */}
      {/* Di HP, dua panel ini ditumpuk absolut & digeser pakai translate-x (bukan cuma
          disembunyikan) supaya perpindahan antar-panel terasa seperti geser panel di
          aplikasi chat native, bukan loncat instan. Di layar md+ kembali ke tata letak
          dua kolom biasa (md:static menetralkan posisi absolut & transform-nya). Lebar
          380px & susunan header/search/list meniru Telegram/WhatsApp Web. */}
      <div
        className={`absolute inset-0 z-10 flex w-full shrink-0 flex-col bg-surface transition-transform duration-300 ease-out md:static md:z-auto md:w-[380px] md:translate-x-0 md:border-r md:border-line ${
          showThreadOnMobile ? "-translate-x-full" : "translate-x-0"
        }`}
      >
        <div className="border-b border-line px-4 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-serif text-lg italic tracking-tight text-ink">Pesan Masuk</h1>
            <LedgerBadge report={ledgerReport} loading={ledgerLoading} onClick={() => setShowLedgerModal(true)} />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1 rounded-lg border border-line bg-canvas p-1">
            <button
              type="button"
              onClick={() => setAccountKey("SERVICE")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-all active:scale-95 ${
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
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-all active:scale-95 ${
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
            <div className="px-3 py-2.5">
              <div className="flex items-center gap-2 rounded-full bg-canvas px-3.5 py-2">
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
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors active:scale-[0.98] active:bg-surface-hover ${
                      active ? "bg-pastel-blue" : "hover:bg-surface-hover"
                    }`}
                  >
                    <span
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                        active ? "bg-surface text-pastel-blue-ink" : "bg-canvas text-ink-muted"
                      }`}
                    >
                      {c.isChannel ? (
                        <IconMegaphone className="h-5 w-5" />
                      ) : c.isGroup ? (
                        <IconUsers className="h-5 w-5" />
                      ) : (
                        initialsOf(c.waNumber)
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={`truncate text-[13px] font-medium ${
                            c.isGroup || c.isChannel || c.contactName ? "" : "font-mono"
                          } ${active ? "text-pastel-blue-ink" : "text-ink"}`}
                        >
                          {c.isChannel
                            ? (c.groupName ?? "Channel")
                            : c.isGroup
                              ? (c.groupName ?? "Grup")
                              : (c.contactName ?? formatPhone(c.waNumber))}
                        </span>
                        <span className={`shrink-0 text-[10.5px] ${active ? "text-pastel-blue-ink/70" : "text-ink-faint"}`}>
                          {relativeDuration(c.lastAt)}
                        </span>
                      </span>
                      {!c.isGroup && !c.isChannel && c.contactName && (
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
      <div
        onTouchStart={handleThreadTouchStart}
        onTouchMove={handleThreadTouchMove}
        onTouchEnd={handleThreadTouchEnd}
        style={isSwiping ? { transform: `translateX(${swipeOffsetPx}px)` } : undefined}
        className={`absolute inset-0 z-10 flex min-w-0 flex-1 flex-col bg-surface ${
          isSwiping ? "" : "transition-transform duration-300 ease-out"
        } md:static md:z-auto md:translate-x-0 ${showThreadOnMobile ? "translate-x-0" : "translate-x-full"}`}
      >
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
                className="-ml-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-all hover:bg-surface-hover hover:text-ink active:scale-90 md:hidden"
                aria-label="Kembali ke daftar"
              >
                <IconArrowLeft className="h-5 w-5" />
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-semibold text-ink-muted">
                  {selected.isChannel ? (
                    <IconMegaphone className="h-4 w-4" />
                  ) : selected.isGroup ? (
                    <IconUsers className="h-4 w-4" />
                  ) : (
                    initialsOf(selected.waNumber)
                  )}
                </span>
                <div className="min-w-0">
                  <p
                    className={`truncate text-sm font-medium text-ink ${
                      selected.isGroup || selected.isChannel || selected.contactName ? "" : "font-mono"
                    }`}
                  >
                    {selected.isChannel
                      ? (selected.groupName ?? "Channel")
                      : selected.isGroup
                        ? (selected.groupName ?? "Grup")
                        : (selected.contactName ?? formatPhone(selected.waNumber))}
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    {!selected.isGroup && !selected.isChannel && selected.contactName && (
                      <span className="font-mono">{formatPhone(selected.waNumber)} &middot; </span>
                    )}
                    {selected.isChannel
                      ? "Channel WA - siaran satu arah, tidak bisa dibalas"
                      : selected.isGroup
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
                  className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 ${
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
                const isAudio = Boolean(m.attachmentUrl && m.attachmentMimeType?.startsWith("audio/"));
                const isOtherFile = Boolean(m.attachmentUrl && !isImage && !isVideo && !isAudio);
                // Stiker tersimpan sebagai image/webp (sama seperti foto) - dibedakan cuma
                // dari labelnya, dirender lebih kecil & tanpa crop (bukan foto persegi panjang).
                const isSticker = isImage && m.message === "[Stiker]";
                // Foto/video yang aslinya dikirim sebagai "sekali lihat" tetap dirender penuh
                // seperti media biasa, tapi diberi penanda kecil di atas medianya - pengirimnya
                // mengira isi ini hangus setelah dibuka sekali, jadi petugas perlu tahu bahwa
                // kiriman ini dimaksudkan sensitif.
                const isViewOnce =
                  (isImage && m.message === "[Foto sekali lihat]") ||
                  (isVideo && m.message === "[Video sekali lihat]");
                // "[Foto]"/"[Video]"/"[Stiker]"/"[Dokumen]" cuma label generik yang dibuat
                // otomatis saat menyimpan lampiran (lihat inboxMedia.ts) - tidak perlu
                // ditampilkan lagi sebagai teks terpisah kalau lampirannya sudah dirender.
                // "Video note" (video bulat) tersimpan sebagai mp4 persegi biasa - dibedakan
                // cuma dari labelnya, lalu dirender bulat & berukuran tetap seperti di
                // WhatsApp, bukan selebar bubble seperti video biasa.
                const isVideoNote = isVideo && m.message === "[Video note]";
                const hideGenericLabel =
                  isViewOnce ||
                  isVideoNote ||
                  (isImage && (m.message === "[Foto]" || m.message === "[Stiker]")) ||
                  (isVideo && m.message === "[Video]") ||
                  (isOtherFile && m.message === "[Dokumen]");
                const bubbleTextClass = m.direction === "OUTBOUND" ? "text-pastel-green-ink" : "text-ink";
                return (
                  <div key={m.id} className={`flex flex-col ${m.direction === "OUTBOUND" ? "items-end" : "items-start"}`}>
                    <div
                      className={`max-w-[80%] overflow-hidden rounded-2xl text-sm shadow-sm sm:max-w-[65%] ${
                        m.direction === "OUTBOUND" ? "rounded-tr-sm bg-pastel-green" : "rounded-tl-sm bg-surface"
                      } ${bubbleTextClass}`}
                    >
                      {isViewOnce && (
                        <div className="flex items-center gap-1.5 px-3.5 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-wide opacity-70">
                          <IconViewOnce className="h-3.5 w-3.5 shrink-0" />
                          Sekali lihat
                        </div>
                      )}
                      {isImage && (
                        <button
                          type="button"
                          onClick={() => setLightboxUrl(m.attachmentUrl)}
                          className="block w-full cursor-zoom-in"
                        >
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
                        </button>
                      )}
                      {isVideo && !isVideoNote && (
                        <video src={m.attachmentUrl!} controls className="block max-h-72 w-full bg-canvas" />
                      )}
                      {isVideoNote && (
                        <div className="p-1.5">
                          <video
                            src={m.attachmentUrl!}
                            controls
                            className="block aspect-square h-48 w-48 max-w-full rounded-full bg-canvas object-cover"
                          />
                        </div>
                      )}
                      {isAudio && (
                        <div className="px-2.5 pt-2.5">
                          <audio src={m.attachmentUrl!} controls preload="metadata" className="h-9 w-56 max-w-full" />
                        </div>
                      )}
                      {isOtherFile && (
                        <a
                          href={m.attachmentUrl!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-2 px-3.5 py-2.5 underline-offset-2 hover:underline ${bubbleTextClass}`}
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
                              {linkifyText(m.message, "text-pastel-blue-ink")}
                              {m.editedAt && (
                                <span className="ml-1 align-middle text-[10px] italic opacity-60">(diedit)</span>
                              )}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-ink-faint">
                      {m.direction === "OUTBOUND"
                        ? (m.adminName ?? (channel === "EXTRA" ? "Dibalas dari HP" : "Petugas"))
                        : selected.isGroup
                          ? (m.senderName ?? m.senderNumber ?? "Anggota grup")
                          : "Warga"}{" "}
                      &middot; {new Date(m.createdAt).toLocaleString("id-ID")}
                      {m.direction === "OUTBOUND" && <MessageStatusTick status={m.status} />}
                    </span>
                  </div>
                );
              })}
            </div>

            {error && <p className="border-t border-line px-5 py-2 text-xs text-pastel-red-ink">{error}</p>}
            {channel === "SERVICE" && !selected.isChannel && !selected.takeoverActive && !error && (
              <p className="border-t border-line px-5 py-2 text-xs text-ink-muted">
                Aktifkan &quot;Ambil Alih&quot; untuk membalas pesan ini secara manual.
              </p>
            )}
            {isDisconnected && !selected.isChannel && !error && (
              <p className="border-t border-line px-5 py-2 text-xs text-ink-muted">
                Akun ini sedang terputus - riwayat tetap bisa dibaca, tapi sambungkan ulang dulu untuk membalas.
              </p>
            )}

            {selected.isChannel ? (
              <div className="flex items-center justify-center gap-2 bg-surface px-4 py-3.5 text-center text-xs text-ink-faint">
                <IconMegaphone className="h-4 w-4 shrink-0" />
                Channel WA cuma siaran satu arah dari pengelolanya - tidak bisa dibalas.
              </div>
            ) : (
            <div className="flex items-end gap-2 bg-surface px-3 py-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,application/pdf,video/mp4,video/3gpp,video/quicktime,video/webm,audio/ogg,audio/mpeg,audio/mp4,audio/webm,audio/wav,audio/x-m4a,audio/m4a"
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
                className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition-all hover:bg-surface-hover active:scale-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
              >
                <IconPaperclip className="h-5 w-5" />
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
                      ? "Ketik balasan..."
                      : "Ambil alih dulu untuk membalas"
                }
                rows={1}
                className="max-h-32 flex-1 resize-none rounded-3xl bg-canvas px-4 py-2.5 text-sm text-ink outline-none transition-colors disabled:cursor-not-allowed disabled:text-ink-faint"
              />
              <button
                onClick={handleSend}
                disabled={!selected.takeoverActive || isDisconnected || sending || !text.trim()}
                aria-label="Kirim"
                className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pastel-green text-pastel-green-ink transition-all hover:opacity-90 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
              >
                <IconSend className="h-[18px] w-[18px] translate-x-[-1px]" />
              </button>
            </div>
            )}
          </>
        )}
      </div>

      {/* ---------- Lightbox: lihat foto/stiker penuh tanpa pindah tab ---------- */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            aria-label="Tutup"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <IconClose className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Lampiran foto"
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}

      {/* ---------- Laporan verifikasi keaslian riwayat chat ---------- */}
      {showLedgerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowLedgerModal(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-lg"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <IconShield className={`h-5 w-5 ${ledgerReport?.ok ? "text-pastel-green-ink" : "text-pastel-red-ink"}`} />
                <h2 className="font-serif text-base italic tracking-tight text-ink">Verifikasi Keaslian Chat</h2>
              </div>
              <button type="button" onClick={() => setShowLedgerModal(false)} aria-label="Tutup" className="text-ink-muted hover:text-ink">
                <IconClose className="h-4 w-4" />
              </button>
            </div>

            {!ledgerReport ? (
              <p className="text-sm text-ink-muted">Memuat laporan...</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div
                  className={`rounded-lg px-3 py-2.5 text-xs font-medium ${
                    ledgerReport.ok ? "bg-pastel-green text-pastel-green-ink" : "bg-pastel-red text-pastel-red-ink"
                  }`}
                >
                  {ledgerReport.ok
                    ? "Riwayat chat utuh - tidak ada satu pun baris atau berkas lampiran yang terdeteksi diubah di luar jalur resmi aplikasi ini."
                    : "Ditemukan ketidaksesuaian - lihat rincian di bawah."}
                </div>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <dt className="text-ink-muted">Diperiksa</dt>
                  <dd className="text-ink">{new Date(ledgerReport.checkedAt).toLocaleString("id-ID")}</dd>
                  <dt className="text-ink-muted">Entri ledger</dt>
                  <dd className="text-ink">{ledgerReport.chain.totalEntries.toLocaleString("id-ID")}</dd>
                  <dt className="text-ink-muted">Lampiran diperiksa</dt>
                  <dd className="text-ink">{ledgerReport.attachmentsChecked.toLocaleString("id-ID")}</dd>
                  <dt className="text-ink-muted">Rantai hash</dt>
                  <dd className={ledgerReport.chain.ok ? "text-pastel-green-ink" : "text-pastel-red-ink"}>
                    {ledgerReport.chain.ok ? "Utuh" : `Putus di entri #${ledgerReport.chain.brokenAtId}`}
                  </dd>
                </dl>

                {!ledgerReport.chain.ok && ledgerReport.chain.reason && (
                  <p className="rounded-md bg-pastel-red px-2.5 py-2 text-xs text-pastel-red-ink">{ledgerReport.chain.reason}</p>
                )}

                {ledgerReport.rowMismatches.length > 0 && (
                  <div className="rounded-md border border-pastel-red bg-pastel-red/40 p-2.5">
                    <p className="mb-1 text-xs font-medium text-pastel-red-ink">Baris pesan tidak cocok ({ledgerReport.rowMismatches.length}):</p>
                    <ul className="space-y-1 text-[11px] text-pastel-red-ink">
                      {ledgerReport.rowMismatches.slice(0, 10).map((m, i) => (
                        <li key={i}>
                          Pesan #{m.inboxMessageId} - field &quot;{m.field}&quot; seharusnya berbeda dari yang tersimpan sekarang
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {ledgerReport.fileMismatches.length > 0 && (
                  <div className="rounded-md border border-pastel-red bg-pastel-red/40 p-2.5">
                    <p className="mb-1 text-xs font-medium text-pastel-red-ink">Berkas lampiran bermasalah ({ledgerReport.fileMismatches.length}):</p>
                    <ul className="space-y-1 text-[11px] text-pastel-red-ink">
                      {ledgerReport.fileMismatches.slice(0, 10).map((m, i) => (
                        <li key={i}>
                          Pesan #{m.inboxMessageId} - {m.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-[11px] leading-relaxed text-ink-faint">
                  Setiap pesan/media dicatat ke buku besar berantai (hash chain) terenkripsi HMAC saat pertama diterima/dikirim - mengubah isinya
                  langsung di database, tanpa lewat aplikasi ini, akan membuat pemeriksaan ini gagal. Riwayat dari sebelum fitur ini aktif dicatat
                  lewat backfill satu kali (kondisinya saat itu), jadi tidak membuktikan keasliannya sebelum tanggal backfill - cuma menjamin tidak
                  ada perubahan sejak saat itu.
                </p>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={runLedgerVerification}
                    disabled={ledgerLoading}
                    className="flex-1 rounded-md border border-line bg-canvas px-3 py-2 text-xs font-medium text-ink transition-colors hover:bg-surface-hover disabled:opacity-50"
                  >
                    {ledgerLoading ? "Memeriksa..." : "Verifikasi Ulang"}
                  </button>
                  <button
                    type="button"
                    onClick={downloadLedgerReport}
                    className="flex-1 rounded-md bg-ink px-3 py-2 text-xs font-medium text-canvas transition-colors hover:opacity-90"
                  >
                    Unduh Laporan
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
