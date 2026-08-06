import { signControlRequest } from "./hmacSign";

const BOT_CONTROL_URL = process.env.BOT_CONTROL_URL ?? "http://127.0.0.1:4001";
const BOT_CONTROL_SECRET = process.env.BOT_CONTROL_SECRET ?? "";

export interface BotStatus {
  connected: boolean;
  isConnecting: boolean;
  waJid: string | null;
  phoneNumber: string | null;
  lastConnectedAt: string | null;
  qrDataUrl: string | null;
  pairingCode: string | null;
}

async function callControlServer(path: string, init?: RequestInit): Promise<Response> {
  const method = init?.method?.toString().toUpperCase() ?? "GET";
  const bodyString = typeof init?.body === "string" ? init.body : "";
  const timestamp = Date.now().toString();
  const signature = signControlRequest(BOT_CONTROL_SECRET, timestamp, method, path, bodyString);

  return fetch(`${BOT_CONTROL_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-timestamp": timestamp,
      "x-signature": signature,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

export async function getBotStatus(): Promise<BotStatus> {
  const res = await callControlServer("/status");
  if (!res.ok) throw new Error("Gagal mengambil status bot");
  return res.json();
}

export async function connectBotQr(): Promise<Response> {
  return callControlServer("/connect-qr", { method: "POST" });
}

export async function connectBotPairing(phoneNumber: string): Promise<Response> {
  return callControlServer("/connect-pairing", { method: "POST", body: JSON.stringify({ phoneNumber }) });
}

export async function logoutBot(): Promise<Response> {
  return callControlServer("/logout", { method: "POST" });
}

/** Best-effort: kegagalan di sini tidak fatal karena reconciler bot akan retry otomatis. */
export async function notifyStatusChange(requestId: string): Promise<void> {
  try {
    await callControlServer("/notify/status-change", {
      method: "POST",
      body: JSON.stringify({ requestId }),
    });
  } catch {
    // diamkan - reconciler di proses bot akan mencoba lagi secara berkala
  }
}

/** Best-effort: kegagalan di sini tidak fatal karena reconciler bot akan retry otomatis. */
export async function notifyReadyForPickup(requestId: string): Promise<void> {
  try {
    await callControlServer("/notify/ready-for-pickup", {
      method: "POST",
      body: JSON.stringify({ requestId }),
    });
  } catch {
    // diamkan - reconciler di proses bot akan mencoba lagi secara berkala
  }
}

/**
 * Pesan bebas tidak punya jalur retry otomatis (bukan notifikasi status baku) -
 * kegagalan harus dikembalikan ke pemanggil supaya admin tahu harus kirim ulang.
 */
export async function sendCustomMessage(requestId: string, message: string): Promise<boolean> {
  try {
    const res = await callControlServer("/notify/custom-message", {
      method: "POST",
      body: JSON.stringify({ requestId, message }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Notifikasi handoff ke warga saat petugas toggle ambil-alih ON/OFF - best-effort, kalau
 * bot sedang offline warga cukup tidak dapat pesan info ini (toggle di DB tetap berlaku).
 */
export async function notifyTakeover(waJid: string, active: boolean): Promise<boolean> {
  try {
    const res = await callControlServer("/notify/takeover", {
      method: "POST",
      body: JSON.stringify({ waJid, active }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Balasan bebas dari halaman Pesan Masuk - beda dari sendCustomMessage karena tidak
 * terikat pada Request, warga yang dibalas bisa jadi belum pernah mengajukan apa pun.
 */
export async function sendInboxReply(
  waJid: string,
  message: string,
  channel: "SERVICE" | "EXTRA" = "SERVICE",
  extraAccountId?: number
): Promise<{ ok: boolean; waMessageId?: string }> {
  try {
    const res = await callControlServer("/notify/inbox-reply", {
      method: "POST",
      body: JSON.stringify({ waJid, message, channel, extraAccountId }),
    });
    if (!res.ok) return { ok: false };
    const data = await res.json().catch(() => ({}));
    return { ok: true, waMessageId: data.waMessageId ?? undefined };
  } catch {
    return { ok: false };
  }
}

/**
 * Kirim soft file (dokumen digital final - mis. scan KK/Akte) ke warga lewat WA. Body
 * base64 bisa cukup besar (sampai ~13-14MB untuk berkas 10MB) - bukan best-effort diam-diam
 * seperti notifikasi status, kegagalan harus dikembalikan ke admin supaya tahu harus ulang.
 */
export async function sendFileToResident(
  requestId: string,
  fileName: string,
  mimeType: string,
  fileBase64: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await callControlServer("/notify/send-file", {
      method: "POST",
      body: JSON.stringify({ requestId, fileName, mimeType, fileBase64 }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error ?? "failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "bot_unreachable" };
  }
}

/**
 * Kirim foto/dokumen ke warga dari halaman Pesan Masuk, tidak terikat Request tertentu.
 * Sama seperti sendFileToResident, kegagalan dikembalikan apa adanya ke admin.
 */
export async function sendInboxFile(
  waJid: string,
  fileName: string,
  mimeType: string,
  fileBase64: string,
  channel: "SERVICE" | "EXTRA" = "SERVICE",
  extraAccountId?: number
): Promise<{ ok: boolean; error?: string; waMessageId?: string }> {
  try {
    const res = await callControlServer("/notify/inbox-file", {
      method: "POST",
      body: JSON.stringify({ waJid, fileName, mimeType, fileBase64, channel, extraAccountId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error ?? "failed" };
    }
    return { ok: true, waMessageId: data.waMessageId ?? undefined };
  } catch {
    return { ok: false, error: "bot_unreachable" };
  }
}

export interface ExtraAccountSummary {
  id: number;
  label: string;
  phoneNumber: string | null;
  lastConnectedAt: string | null;
  connected: boolean;
  isConnecting: boolean;
}

export interface ExtraAccountStatus extends BotStatus {
  id: number;
}

/**
 * Akun-akun ekstra (perangkat tertaut manual, bukan bot layanan) - bisa lebih dari satu
 * (Akun Kedua, Akun Ketiga, dst), dipakai halaman /admin-xpawto. Struktur mirip
 * getBotStatus/connectBotQr/dst, cuma dibedakan per id lewat endpoint /extra-accounts/*.
 */
export async function listExtraAccounts(): Promise<ExtraAccountSummary[]> {
  const res = await callControlServer("/extra-accounts");
  if (!res.ok) throw new Error("Gagal mengambil daftar akun ekstra");
  const data = await res.json();
  return data.accounts;
}

export async function createExtraAccount(label: string): Promise<{ id: number; label: string } | null> {
  const res = await callControlServer("/extra-accounts", { method: "POST", body: JSON.stringify({ label }) });
  if (!res.ok) return null;
  return res.json();
}

export async function getExtraAccountStatus(id: number): Promise<ExtraAccountStatus> {
  const res = await callControlServer(`/extra-accounts/${id}/status`);
  if (!res.ok) throw new Error("Gagal mengambil status akun ekstra");
  const data = await res.json();
  return { ...data, id };
}

export async function connectExtraAccountQr(id: number): Promise<Response> {
  return callControlServer(`/extra-accounts/${id}/connect-qr`, { method: "POST" });
}

export async function connectExtraAccountPairing(id: number, phoneNumber: string): Promise<Response> {
  return callControlServer(`/extra-accounts/${id}/connect-pairing`, {
    method: "POST",
    body: JSON.stringify({ phoneNumber }),
  });
}

export async function logoutExtraAccount(id: number): Promise<Response> {
  return callControlServer(`/extra-accounts/${id}/logout`, { method: "POST" });
}

export async function deleteExtraAccount(id: number): Promise<Response> {
  return callControlServer(`/extra-accounts/${id}`, { method: "DELETE" });
}

/** Mengembalikan alasan gagal (kalau ada) supaya bisa ditampilkan ke admin. */
export async function startBroadcast(message: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await callControlServer("/broadcast", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error ?? "failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "bot_unreachable" };
  }
}
