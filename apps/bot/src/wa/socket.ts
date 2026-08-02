import fs from "fs";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import { config } from "../config";
import { logger } from "../logger";
import { handleIncomingMessages } from "../conversation/messageHandler";
import { handleIncomingCalls } from "../conversation/callHandler";
import { getBackoffDelay, getDisconnectStatusCode, markBotConnected, markBotDisconnected } from "./connection";
import { waState } from "./state";

export type ConnectMode = { type: "qr" } | { type: "pairing"; phoneNumber: string };

export function getSocket() {
  return waState.sock;
}

export async function startSocket(mode: ConnectMode = { type: "qr" }): Promise<void> {
  if (waState.isConnecting) {
    logger.warn("Permintaan koneksi diabaikan: proses koneksi lain sedang berjalan.");
    return;
  }

  // Pastikan tidak ada dua socket yang rebutan folder auth yang sama.
  if (waState.sock) {
    try {
      waState.sock.end(undefined);
    } catch {
      // socket sudah mati, aman diabaikan
    }
    waState.sock = null;
  }

  waState.isConnecting = true;
  waState.qrDataUrl = null;
  waState.pairingCode = null;
  waState.pendingPairingNumber = mode.type === "pairing" ? mode.phoneNumber : null;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(config.waAuthDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: logger.child({ module: "baileys" }) as any,
      printQRInTerminal: false,
      syncFullHistory: false,
      browser: Browsers.ubuntu("Chrome"),
    });

    waState.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    if (mode.type === "pairing" && !state.creds.registered) {
      setTimeout(() => {
        sock
          .requestPairingCode(mode.phoneNumber)
          .then((code) => {
            waState.pairingCode = code;
            logger.info({ code }, "Kode pairing dibuat, masukkan di menu Perangkat Tertaut WhatsApp.");
          })
          .catch((err) => logger.error({ err }, "Gagal membuat kode pairing"));
      }, 3000);
    }

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && mode.type === "qr") {
        waState.qrDataUrl = await QRCode.toDataURL(qr);
        qrcodeTerminal.generate(qr, { small: true });
        logger.info("QR baru dibuat. Scan lewat dashboard (/bot) atau terminal.");
      }

      if (connection === "open") {
        waState.isConnecting = false;
        waState.reconnectAttempt = 0;
        waState.connected = true;
        waState.qrDataUrl = null;
        waState.pairingCode = null;
        const waJid = sock.user?.id;
        const phoneNumber = waJid?.split(":")[0];
        await markBotConnected(waJid, phoneNumber);
      }

      if (connection === "close") {
        waState.isConnecting = false;
        waState.connected = false;
        await markBotDisconnected();

        const statusCode = getDisconnectStatusCode(lastDisconnect);
        if (statusCode === DisconnectReason.loggedOut) {
          logger.warn("Sesi WA logout. Hapus folder auth & tunggu koneksi ulang manual dari dashboard.");
          waState.sock = null;
          waState.reconnectAttempt = 0;
          await fs.promises.rm(config.waAuthDir, { recursive: true, force: true }).catch(() => undefined);
          return;
        }

        const delay = getBackoffDelay();
        waState.reconnectAttempt += 1;
        logger.warn({ statusCode, delay }, "Koneksi WA terputus, mencoba reconnect otomatis...");
        setTimeout(() => {
          startSocket({ type: "qr" }).catch((err) => logger.error({ err }, "Gagal reconnect"));
        }, delay);
      }
    });

    sock.ev.on("messages.upsert", (payload) => {
      handleIncomingMessages(sock, payload).catch((err) =>
        logger.error({ err }, "Gagal memproses pesan masuk")
      );
    });

    sock.ev.on("call", (events) => {
      handleIncomingCalls(sock, events).catch((err) => logger.error({ err }, "Gagal memproses panggilan masuk"));
    });
  } catch (err) {
    waState.isConnecting = false;
    throw err;
  }
}

export async function logoutSocket(): Promise<void> {
  const sock = waState.sock;
  if (sock) {
    try {
      await sock.logout();
    } catch (err) {
      logger.warn({ err }, "Logout socket gagal (kemungkinan sudah terputus)");
    }
  }
  waState.sock = null;
  waState.connected = false;
  waState.qrDataUrl = null;
  waState.pairingCode = null;
  waState.reconnectAttempt = 0;
  await fs.promises.rm(config.waAuthDir, { recursive: true, force: true }).catch(() => undefined);
  await markBotDisconnected();
}
