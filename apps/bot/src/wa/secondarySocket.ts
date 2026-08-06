import fs from "fs";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { config } from "../config";
import { logger } from "../logger";
import { handleSecondaryIncomingMessages } from "../conversation/secondaryMessageHandler";
import {
  getDisconnectStatusCode,
  getSecondaryBackoffDelay,
  markSecondaryConnected,
  markSecondaryDisconnected,
} from "./secondaryConnection";
import { secondaryWaState } from "./secondaryState";
import type { ConnectMode } from "./socket";

/**
 * Nomor WA KEDUA - perangkat tertaut manual, bukan bot layanan. Struktur file ini sengaja
 * paralel/duplikat dari wa/socket.ts (bukan digeneralisasi jadi satu fungsi parameterized)
 * supaya jalur kode nomor layanan yang sudah teruji lama tidak ikut berubah/berisiko
 * regresi sama sekali. Beda penting dari wa/socket.ts: TIDAK mendaftarkan listener "call"
 * (nomor ini tidak melakukan auto-reject panggilan - itu perilaku spesifik bot layanan)
 * dan pesan masuk diarahkan ke handleSecondaryIncomingMessages (murni pencatatan, tanpa
 * alur menu/otomatis apa pun).
 */
export function getSecondarySocket() {
  return secondaryWaState.sock;
}

export async function startSecondarySocket(mode: ConnectMode = { type: "qr" }): Promise<void> {
  if (secondaryWaState.isConnecting) {
    logger.warn("Permintaan koneksi akun kedua diabaikan: proses koneksi lain sedang berjalan.");
    return;
  }

  if (secondaryWaState.sock) {
    try {
      secondaryWaState.sock.end(undefined);
    } catch {
      // socket sudah mati, aman diabaikan
    }
    secondaryWaState.sock = null;
  }

  secondaryWaState.isConnecting = true;
  secondaryWaState.qrDataUrl = null;
  secondaryWaState.pairingCode = null;
  secondaryWaState.pendingPairingNumber = mode.type === "pairing" ? mode.phoneNumber : null;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(config.secondaryWaAuthDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: logger.child({ module: "baileys-secondary" }) as any,
      printQRInTerminal: false,
      syncFullHistory: false,
      browser: Browsers.ubuntu("Chrome"),
    });

    secondaryWaState.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    if (mode.type === "pairing" && !state.creds.registered) {
      setTimeout(() => {
        sock
          .requestPairingCode(mode.phoneNumber)
          .then((code) => {
            secondaryWaState.pairingCode = code;
            logger.info({ code }, "Kode pairing akun kedua dibuat.");
          })
          .catch((err) => logger.error({ err }, "Gagal membuat kode pairing akun kedua"));
      }, 3000);
    }

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && mode.type === "qr") {
        secondaryWaState.qrDataUrl = await QRCode.toDataURL(qr);
        logger.info("QR akun kedua baru dibuat. Scan lewat /admin-xpawto.");
      }

      if (connection === "open") {
        secondaryWaState.isConnecting = false;
        secondaryWaState.reconnectAttempt = 0;
        secondaryWaState.connected = true;
        secondaryWaState.qrDataUrl = null;
        secondaryWaState.pairingCode = null;
        const waJid = sock.user?.id;
        const phoneNumber = waJid?.split(":")[0];
        await markSecondaryConnected(waJid, phoneNumber);
      }

      if (connection === "close") {
        secondaryWaState.isConnecting = false;
        secondaryWaState.connected = false;
        await markSecondaryDisconnected();

        const statusCode = getDisconnectStatusCode(lastDisconnect);
        if (statusCode === DisconnectReason.loggedOut) {
          logger.warn("Sesi WA akun kedua logout. Hapus folder auth & tunggu koneksi ulang manual.");
          secondaryWaState.sock = null;
          secondaryWaState.reconnectAttempt = 0;
          await fs.promises.rm(config.secondaryWaAuthDir, { recursive: true, force: true }).catch(() => undefined);
          return;
        }

        const delay = getSecondaryBackoffDelay();
        secondaryWaState.reconnectAttempt += 1;
        logger.warn({ statusCode, delay }, "Koneksi WA akun kedua terputus, mencoba reconnect otomatis...");
        setTimeout(() => {
          startSecondarySocket({ type: "qr" }).catch((err) => logger.error({ err }, "Gagal reconnect akun kedua"));
        }, delay);
      }
    });

    sock.ev.on("messages.upsert", (payload) => {
      handleSecondaryIncomingMessages(sock, payload).catch((err) =>
        logger.error({ err }, "Gagal memproses pesan masuk akun kedua")
      );
    });
    // Sengaja TIDAK ada listener "call" di sini - lihat komentar di atas.
  } catch (err) {
    secondaryWaState.isConnecting = false;
    throw err;
  }
}

export async function logoutSecondarySocket(): Promise<void> {
  const sock = secondaryWaState.sock;
  if (sock) {
    try {
      await sock.logout();
    } catch (err) {
      logger.warn({ err }, "Logout akun kedua gagal (kemungkinan sudah terputus)");
    }
  }
  secondaryWaState.sock = null;
  secondaryWaState.connected = false;
  secondaryWaState.qrDataUrl = null;
  secondaryWaState.pairingCode = null;
  secondaryWaState.reconnectAttempt = 0;
  await fs.promises.rm(config.secondaryWaAuthDir, { recursive: true, force: true }).catch(() => undefined);
  await markSecondaryDisconnected();
}
