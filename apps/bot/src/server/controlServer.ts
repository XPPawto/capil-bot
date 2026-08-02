import express from "express";
import { prisma } from "@kelurahan/db";
import { config } from "../config";
import { logger } from "../logger";
import { sendStatusMessage } from "../notify/sendStatusMessage";
import { sendReadyForPickupMessage } from "../notify/sendReadyForPickup";
import { sendCustomMessage } from "../notify/sendCustomMessage";
import { logoutSocket, startSocket } from "../wa/socket";
import { waState } from "../wa/state";

/**
 * HTTP kecil yang HANYA bind ke 127.0.0.1 dan dilindungi shared-secret header.
 * Satu-satunya klien adalah API route Next.js (browser tidak pernah bicara
 * langsung ke sini) - route Next.js itu sendiri sudah digerbangi sesi admin.
 */
export function startControlServer(): void {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    const secret = req.header("x-control-secret");
    if (secret !== config.controlSecret) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });

  app.get("/status", async (_req, res) => {
    const botSession = await prisma.botSession.findUnique({ where: { id: 1 } });
    res.json({
      connected: waState.connected,
      isConnecting: waState.isConnecting,
      waJid: botSession?.waJid ?? null,
      phoneNumber: botSession?.phoneNumber ?? null,
      lastConnectedAt: botSession?.lastConnectedAt ?? null,
      qrDataUrl: waState.qrDataUrl,
      pairingCode: waState.pairingCode,
    });
  });

  app.post("/connect-qr", (_req, res) => {
    if (waState.connected) {
      res.status(409).json({ error: "already_connected" });
      return;
    }
    startSocket({ type: "qr" }).catch((err) => logger.error({ err }, "Gagal memulai koneksi via QR"));
    res.json({ ok: true });
  });

  app.post("/connect-pairing", (req, res) => {
    if (waState.connected) {
      res.status(409).json({ error: "already_connected" });
      return;
    }
    const phoneNumber = String(req.body?.phoneNumber ?? "").replace(/\D/g, "");
    if (!phoneNumber || phoneNumber.length < 8) {
      res.status(400).json({ error: "invalid_phone_number" });
      return;
    }
    startSocket({ type: "pairing", phoneNumber }).catch((err) =>
      logger.error({ err }, "Gagal memulai koneksi via kode pairing")
    );
    res.json({ ok: true });
  });

  app.post("/logout", async (_req, res) => {
    await logoutSocket();
    res.json({ ok: true });
  });

  app.post("/notify/status-change", async (req, res) => {
    const requestId = String(req.body?.requestId ?? "");
    if (!requestId) {
      res.status(400).json({ error: "missing_request_id" });
      return;
    }
    try {
      await sendStatusMessage(requestId);
      res.json({ ok: true });
    } catch (err) {
      logger.warn({ err, requestId }, "Gagal kirim notifikasi langsung, akan di-retry oleh reconciler");
      res.status(202).json({ ok: false, retried: true });
    }
  });

  app.post("/notify/ready-for-pickup", async (req, res) => {
    const requestId = String(req.body?.requestId ?? "");
    if (!requestId) {
      res.status(400).json({ error: "missing_request_id" });
      return;
    }
    try {
      await sendReadyForPickupMessage(requestId);
      res.json({ ok: true });
    } catch (err) {
      logger.warn({ err, requestId }, "Gagal kirim notifikasi siap diambil, akan di-retry oleh reconciler");
      res.status(202).json({ ok: false, retried: true });
    }
  });

  app.post("/notify/custom-message", async (req, res) => {
    const requestId = String(req.body?.requestId ?? "");
    const message = String(req.body?.message ?? "");
    if (!requestId || !message.trim()) {
      res.status(400).json({ error: "missing_fields" });
      return;
    }
    try {
      await sendCustomMessage(requestId, message);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err, requestId }, "Gagal mengirim pesan bebas ke warga");
      res.status(502).json({ error: "send_failed" });
    }
  });

  app.listen(config.controlPort, "127.0.0.1", () => {
    logger.info(`Control server bot berjalan di http://127.0.0.1:${config.controlPort}`);
  });
}
