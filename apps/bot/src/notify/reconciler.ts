import { prisma } from "@kelurahan/db";
import { logger } from "../logger";
import { waState } from "../wa/state";
import { sendStatusMessage } from "./sendStatusMessage";
import { sendReadyForPickupMessage } from "./sendReadyForPickup";

const POLL_INTERVAL_MS = 25_000;
const LOOKBACK_DAYS = 7;

let running = false;

/**
 * Jaring pengaman durabilitas: kalau panggilan HTTP dari web ke control server
 * gagal (bot down/network blip) saat admin ubah status atau kirim notifikasi
 * "siap diambil", pesan WA tidak boleh hilang begitu saja. Loop ini polling
 * berkala dan mengirim ulang yang tertinggal.
 */
export function startReconciler(): void {
  setInterval(() => {
    reconcileOnce().catch((err) => logger.error({ err }, "Reconciler gagal berjalan"));
  }, POLL_INTERVAL_MS);
}

async function reconcileOnce(): Promise<void> {
  if (running || !waState.connected) return;
  running = true;
  try {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await prisma.request.findMany({
      where: {
        updatedAt: { gte: since },
        OR: [{ status: { not: "DICEK" } }, { readyForPickupRequestedAt: { not: null } }],
      },
    });

    for (const req of candidates) {
      if (req.status !== "DICEK" && req.notifiedStatus !== req.status) {
        try {
          await sendStatusMessage(req.id);
          logger.info({ requestId: req.id, status: req.status }, "Reconciler: notifikasi status tertunda terkirim");
        } catch (err) {
          logger.warn({ err, requestId: req.id }, "Reconciler: gagal kirim notifikasi status, dicoba lagi nanti");
        }
      }

      const needsReadyForPickupRetry =
        req.status === "DIPROSES" &&
        req.readyForPickupRequestedAt &&
        (!req.readyForPickupSentAt || req.readyForPickupSentAt < req.readyForPickupRequestedAt);

      if (needsReadyForPickupRetry) {
        try {
          await sendReadyForPickupMessage(req.id);
          logger.info({ requestId: req.id }, "Reconciler: notifikasi siap-diambil tertunda terkirim");
        } catch (err) {
          logger.warn({ err, requestId: req.id }, "Reconciler: gagal kirim notifikasi siap-diambil, dicoba lagi nanti");
        }
      }
    }
  } finally {
    running = false;
  }
}
