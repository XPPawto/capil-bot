import fs from "fs";
import path from "path";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import type { WASocket } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { prisma } from "@kelurahan/db";
import { config } from "../config";
import { logger } from "../logger";
import type { ConnectMode } from "./socket";
import { handleExtraAccountIncomingMessages } from "../conversation/extraAccountMessageHandler";
import { handleMessageStatusUpdates } from "../conversation/messageHandler";
import { handleExtraAccountCalls } from "../conversation/extraAccountCallHandler";

interface ExtraAccountRuntime {
  sock: WASocket | null;
  isConnecting: boolean;
  connected: boolean;
  qrDataUrl: string | null;
  pairingCode: string | null;
  reconnectAttempt: number;
}

const BACKOFF_SCHEDULE_MS = [2000, 5000, 15000, 30000];

/**
 * Menggantikan wa/secondarySocket.ts + secondaryState.ts + secondaryConnection.ts (yang
 * dulu cuma bisa satu akun tambahan, id tetap 1) - sekarang bisa berapa pun akun ekstra
 * sekaligus, masing-masing dikunci oleh ExtraAccount.id-nya sendiri. Satu Map runtime di
 * memori per akun (persis pola wa/state.ts, cuma di-multi-instance-kan), dan satu folder
 * auth Baileys terpisah per akun supaya sesinya tidak saling rebutan.
 */
const runtimes = new Map<number, ExtraAccountRuntime>();

function getRuntime(accountId: number): ExtraAccountRuntime {
  let runtime = runtimes.get(accountId);
  if (!runtime) {
    runtime = { sock: null, isConnecting: false, connected: false, qrDataUrl: null, pairingCode: null, reconnectAttempt: 0 };
    runtimes.set(accountId, runtime);
  }
  return runtime;
}

function authDirFor(accountId: number): string {
  return path.join(config.extraAccountAuthDir, String(accountId));
}

export function getExtraAccountSocket(accountId: number): WASocket | null {
  return runtimes.get(accountId)?.sock ?? null;
}

export function getExtraAccountRuntimeStatus(accountId: number) {
  const r = getRuntime(accountId);
  return {
    connected: r.connected,
    isConnecting: r.isConnecting,
    qrDataUrl: r.qrDataUrl,
    pairingCode: r.pairingCode,
  };
}

async function markExtraAccountConnected(accountId: number, waJid: string | undefined, phoneNumber: string | undefined): Promise<void> {
  await prisma.extraAccount.update({
    where: { id: accountId },
    data: { waJid, phoneNumber, connected: true, lastConnectedAt: new Date() },
  });
  logger.info({ accountId, waJid, phoneNumber }, "Akun ekstra terhubung");
}

async function markExtraAccountDisconnected(accountId: number): Promise<void> {
  await prisma.extraAccount
    .update({ where: { id: accountId }, data: { connected: false } })
    .catch(() => undefined); // akun mungkin sudah dihapus - abaikan
}

export async function startExtraAccountSocket(accountId: number, mode: ConnectMode = { type: "qr" }): Promise<void> {
  const runtime = getRuntime(accountId);
  if (runtime.isConnecting) {
    logger.warn({ accountId }, "Permintaan koneksi akun ekstra diabaikan: proses koneksi lain sedang berjalan.");
    return;
  }

  if (runtime.sock) {
    try {
      runtime.sock.end(undefined);
    } catch {
      // socket sudah mati, aman diabaikan
    }
    runtime.sock = null;
  }

  runtime.isConnecting = true;
  runtime.qrDataUrl = null;
  runtime.pairingCode = null;

  try {
    const authDir = authDirFor(accountId);
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: logger.child({ module: "baileys-extra", accountId }) as any,
      printQRInTerminal: false,
      syncFullHistory: false,
      browser: Browsers.ubuntu("Chrome"),
    });

    runtime.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    if (mode.type === "pairing" && !state.creds.registered) {
      setTimeout(() => {
        sock
          .requestPairingCode(mode.phoneNumber)
          .then((code) => {
            runtime.pairingCode = code;
            logger.info({ accountId, code }, "Kode pairing akun ekstra dibuat.");
          })
          .catch((err) => logger.error({ err, accountId }, "Gagal membuat kode pairing akun ekstra"));
      }, 3000);
    }

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && mode.type === "qr") {
        runtime.qrDataUrl = await QRCode.toDataURL(qr);
        logger.info({ accountId }, "QR akun ekstra baru dibuat. Scan lewat /admin-xpawto.");
      }

      if (connection === "open") {
        runtime.isConnecting = false;
        runtime.reconnectAttempt = 0;
        runtime.connected = true;
        runtime.qrDataUrl = null;
        runtime.pairingCode = null;
        const waJid = sock.user?.id;
        const phoneNumber = waJid?.split(":")[0];
        await markExtraAccountConnected(accountId, waJid, phoneNumber);
      }

      if (connection === "close") {
        runtime.isConnecting = false;
        runtime.connected = false;
        await markExtraAccountDisconnected(accountId);

        const err = lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
        const statusCode = err?.output?.statusCode;
        if (statusCode === DisconnectReason.loggedOut) {
          logger.warn({ accountId }, "Sesi WA akun ekstra logout. Hapus folder auth & tunggu koneksi ulang manual.");
          runtime.sock = null;
          runtime.reconnectAttempt = 0;
          await fs.promises.rm(authDir, { recursive: true, force: true }).catch(() => undefined);
          return;
        }

        const delay = BACKOFF_SCHEDULE_MS[Math.min(runtime.reconnectAttempt, BACKOFF_SCHEDULE_MS.length - 1)];
        runtime.reconnectAttempt += 1;
        logger.warn({ accountId, statusCode, delay }, "Koneksi WA akun ekstra terputus, mencoba reconnect otomatis...");
        setTimeout(() => {
          startExtraAccountSocket(accountId, { type: "qr" }).catch((err2) =>
            logger.error({ err: err2, accountId }, "Gagal reconnect akun ekstra")
          );
        }, delay);
      }
    });

    sock.ev.on("messages.upsert", (payload) => {
      handleExtraAccountIncomingMessages(sock, payload, accountId).catch((err) =>
        logger.error({ err, accountId }, "Gagal memproses pesan masuk akun ekstra")
      );
    });

    sock.ev.on("messages.update", (updates) => {
      handleMessageStatusUpdates(updates, "EXTRA", accountId).catch((err) =>
        logger.error({ err, accountId }, "Gagal memproses status centang pesan akun ekstra")
      );
    });
    // Panggilan TIDAK ditolak otomatis (beda dari nomor layanan) - dibiarkan berdering
    // normal supaya bisa benar-benar diangkat manusia, cuma hasil akhirnya dicatat.
    sock.ev.on("call", (events) => {
      handleExtraAccountCalls(sock, events, accountId).catch((err) =>
        logger.error({ err, accountId }, "Gagal mencatat panggilan akun ekstra")
      );
    });
  } catch (err) {
    runtime.isConnecting = false;
    throw err;
  }
}

export async function logoutExtraAccountSocket(accountId: number): Promise<void> {
  const runtime = getRuntime(accountId);
  if (runtime.sock) {
    try {
      await runtime.sock.logout();
    } catch (err) {
      logger.warn({ err, accountId }, "Logout akun ekstra gagal (kemungkinan sudah terputus)");
    }
  }
  runtime.sock = null;
  runtime.connected = false;
  runtime.qrDataUrl = null;
  runtime.pairingCode = null;
  runtime.reconnectAttempt = 0;
  await fs.promises.rm(authDirFor(accountId), { recursive: true, force: true }).catch(() => undefined);
  await markExtraAccountDisconnected(accountId);
}

/**
 * Dipanggil sekali saat proses bot boot - sambungkan ulang SEMUA akun ekstra yang sudah
 * pernah tertaut sebelumnya (kredensial tersimpan), sama seperti nomor layanan utama.
 * Akun yang belum pernah tertaut sama sekali (baru dibuat, belum discan QR-nya) tidak
 * ikut di sini - baru mulai begitu admin buka tab-nya di /admin-xpawto.
 */
export async function startAllExtraAccountSockets(): Promise<void> {
  const accounts = await prisma.extraAccount.findMany({ select: { id: true } });
  for (const { id } of accounts) {
    const authDir = authDirFor(id);
    const hasCreds = await fs.promises
      .access(path.join(authDir, "creds.json"))
      .then(() => true)
      .catch(() => false);
    if (!hasCreds) continue; // belum pernah discan - biarkan idle sampai admin mulai dari dashboard
    startExtraAccountSocket(id, { type: "qr" }).catch((err) =>
      logger.error({ err, accountId: id }, "Gagal menyambungkan ulang akun ekstra saat boot")
    );
  }
}

export async function markAllExtraAccountsDisconnected(): Promise<void> {
  await prisma.extraAccount.updateMany({ data: { connected: false } });
}
