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
  return fetch(`${BOT_CONTROL_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-control-secret": BOT_CONTROL_SECRET,
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
