import express from "express";
import { prisma } from "@kelurahan/db";
import { config } from "../config";
import { logger } from "../logger";
import { verifyControlRequestSignature } from "./hmac";
import { sendStatusMessage } from "../notify/sendStatusMessage";
import { sendReadyForPickupMessage } from "../notify/sendReadyForPickup";
import { sendCustomMessage } from "../notify/sendCustomMessage";
import { sendTakeoverNotice } from "../notify/sendTakeoverNotice";
import { sendFileToResident } from "../notify/sendFileToResident";
import { sendInboxReply } from "../notify/sendInboxReply";
import { sendInboxFile } from "../notify/sendInboxFile";
import { runBroadcast } from "../notify/broadcast";
import { logoutSocket, startSocket } from "../wa/socket";
import { waState } from "../wa/state";
import {
  getExtraAccountRuntimeStatus,
  logoutExtraAccountSocket,
  startExtraAccountSocket,
} from "../wa/extraAccountManager";

/**
 * HTTP kecil yang HANYA bind ke 127.0.0.1 dan dilindungi shared-secret header.
 * Satu-satunya klien adalah API route Next.js (browser tidak pernah bicara
 * langsung ke sini) - route Next.js itu sendiri sudah digerbangi sesi admin.
 */
interface RequestWithRawBody extends express.Request {
  rawBody?: string;
}

export function startControlServer(): void {
  const app = express();
  // verify: simpan body mentah persis seperti yang diterima di jaringan, supaya HMAC
  // diverifikasi terhadap byte yang sama persis dengan yang ditandatangani sisi web -
  // menyusun ulang JSON.stringify(req.body) di sini berisiko beda urutan/whitespace.
  app.use(
    express.json({
      // 24mb: cukup untuk file base64 (berkas 16MB -> ~21.4MB base64) + overhead JSON,
      // dipakai endpoint /notify/send-file & /notify/inbox-file untuk berkas yang dikirim
      // admin ke warga (termasuk video/voice note lewat /admin-xpawto).
      limit: "24mb",
      verify: (req, _res, buf) => {
        (req as RequestWithRawBody).rawBody = buf.toString("utf8");
      },
    })
  );

  app.use((req, res, next) => {
    const rawBody = (req as RequestWithRawBody).rawBody ?? "";
    const valid = verifyControlRequestSignature(
      config.controlSecret,
      req.header("x-timestamp"),
      req.header("x-signature"),
      req.method,
      req.path,
      rawBody
    );
    if (!valid) {
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

  // ---- Akun ekstra (perangkat tertaut manual, bukan bot) - dipakai halaman /admin-xpawto ----
  // Bisa lebih dari satu (Akun Kedua, Akun Ketiga, dst), masing-masing dikunci oleh id-nya.

  app.get("/extra-accounts", async (_req, res) => {
    const accounts = await prisma.extraAccount.findMany({ orderBy: { id: "asc" } });
    res.json({
      accounts: accounts.map((a) => ({
        id: a.id,
        label: a.label,
        phoneNumber: a.phoneNumber,
        lastConnectedAt: a.lastConnectedAt,
        ...getExtraAccountRuntimeStatus(a.id),
      })),
    });
  });

  app.post("/extra-accounts", async (req, res) => {
    const label = String(req.body?.label ?? "").trim();
    if (!label) {
      res.status(400).json({ error: "missing_label" });
      return;
    }
    const account = await prisma.extraAccount.create({ data: { label } });
    res.json({ id: account.id, label: account.label });
  });

  app.get("/extra-accounts/:id/status", async (req, res) => {
    const id = Number(req.params.id);
    const account = await prisma.extraAccount.findUnique({ where: { id } });
    if (!account) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({
      waJid: account.waJid,
      phoneNumber: account.phoneNumber,
      lastConnectedAt: account.lastConnectedAt,
      // connected/isConnecting/qrDataUrl/pairingCode dari runtime in-memory (live), bukan
      // kolom DB yang bisa basi sesaat setelah proses restart sebelum reconnect selesai.
      ...getExtraAccountRuntimeStatus(id),
    });
  });

  app.post("/extra-accounts/:id/connect-qr", async (req, res) => {
    const id = Number(req.params.id);
    const account = await prisma.extraAccount.findUnique({ where: { id } });
    if (!account) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (account.connected) {
      res.status(409).json({ error: "already_connected" });
      return;
    }
    startExtraAccountSocket(id, { type: "qr" }).catch((err) =>
      logger.error({ err, accountId: id }, "Gagal memulai koneksi akun ekstra via QR")
    );
    res.json({ ok: true });
  });

  app.post("/extra-accounts/:id/connect-pairing", async (req, res) => {
    const id = Number(req.params.id);
    const account = await prisma.extraAccount.findUnique({ where: { id } });
    if (!account) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (account.connected) {
      res.status(409).json({ error: "already_connected" });
      return;
    }
    const phoneNumber = String(req.body?.phoneNumber ?? "").replace(/\D/g, "");
    if (!phoneNumber || phoneNumber.length < 8) {
      res.status(400).json({ error: "invalid_phone_number" });
      return;
    }
    startExtraAccountSocket(id, { type: "pairing", phoneNumber }).catch((err) =>
      logger.error({ err, accountId: id }, "Gagal memulai koneksi akun ekstra via kode pairing")
    );
    res.json({ ok: true });
  });

  app.post("/extra-accounts/:id/logout", async (req, res) => {
    const id = Number(req.params.id);
    await logoutExtraAccountSocket(id);
    res.json({ ok: true });
  });

  app.delete("/extra-accounts/:id", async (req, res) => {
    const id = Number(req.params.id);
    await logoutExtraAccountSocket(id).catch(() => undefined);
    await prisma.extraAccount.delete({ where: { id } }).catch(() => undefined);
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

  app.post("/notify/takeover", async (req, res) => {
    const waJid = String(req.body?.waJid ?? "");
    const active = Boolean(req.body?.active);
    if (!waJid) {
      res.status(400).json({ error: "missing_wajid" });
      return;
    }
    try {
      await sendTakeoverNotice(waJid, active);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err, waJid, active }, "Gagal mengirim notifikasi ambil-alih percakapan");
      res.status(502).json({ error: "send_failed" });
    }
  });

  app.post("/notify/inbox-reply", async (req, res) => {
    const waJid = String(req.body?.waJid ?? "");
    const message = String(req.body?.message ?? "");
    const channel = req.body?.channel === "EXTRA" ? "EXTRA" : "SERVICE";
    const extraAccountId = req.body?.extraAccountId ? Number(req.body.extraAccountId) : undefined;
    if (!waJid || !message.trim()) {
      res.status(400).json({ error: "missing_fields" });
      return;
    }
    try {
      const waMessageId = await sendInboxReply(waJid, message, channel, extraAccountId);
      res.json({ ok: true, waMessageId: waMessageId ?? null });
    } catch (err) {
      logger.error({ err, waJid }, "Gagal mengirim balasan kotak masuk ke warga");
      res.status(502).json({ error: "send_failed" });
    }
  });

  app.post("/notify/inbox-file", async (req, res) => {
    const waJid = String(req.body?.waJid ?? "");
    const fileName = String(req.body?.fileName ?? "berkas");
    const mimeType = String(req.body?.mimeType ?? "application/octet-stream");
    const fileBase64 = String(req.body?.fileBase64 ?? "");
    const channel = req.body?.channel === "EXTRA" ? "EXTRA" : "SERVICE";
    const extraAccountId = req.body?.extraAccountId ? Number(req.body.extraAccountId) : undefined;
    if (!waJid || !fileBase64) {
      res.status(400).json({ error: "missing_fields" });
      return;
    }
    try {
      const waMessageId = await sendInboxFile(waJid, fileName, mimeType, fileBase64, channel, extraAccountId);
      res.json({ ok: true, waMessageId: waMessageId ?? null });
    } catch (err) {
      logger.error({ err, waJid, fileName }, "Gagal mengirim file lewat Pesan Masuk");
      res.status(502).json({ error: "send_failed" });
    }
  });

  app.post("/notify/send-file", async (req, res) => {
    const requestId = String(req.body?.requestId ?? "");
    const fileName = String(req.body?.fileName ?? "dokumen");
    const mimeType = String(req.body?.mimeType ?? "application/octet-stream");
    const fileBase64 = String(req.body?.fileBase64 ?? "");
    if (!requestId || !fileBase64) {
      res.status(400).json({ error: "missing_fields" });
      return;
    }
    try {
      await sendFileToResident(requestId, fileName, mimeType, fileBase64);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err, requestId, fileName }, "Gagal mengirim file dokumen ke warga");
      res.status(502).json({ error: "send_failed" });
    }
  });

  app.post("/broadcast", (req, res) => {
    const message = String(req.body?.message ?? "").trim();
    if (!message) {
      res.status(400).json({ error: "empty_message" });
      return;
    }
    if (!waState.connected) {
      res.status(409).json({ error: "not_connected" });
      return;
    }
    // Respons langsung - pengiriman sesungguhnya jalan di background (bisa lama
    // kalau penerimanya banyak, dikasih jeda antar pesan di dalam runBroadcast).
    res.json({ ok: true });
    runBroadcast(message).catch((err) => logger.error({ err }, "Broadcast gagal berjalan"));
  });

  app.listen(config.controlPort, "127.0.0.1", () => {
    logger.info(`Control server bot berjalan di http://127.0.0.1:${config.controlPort}`);
  });
}
