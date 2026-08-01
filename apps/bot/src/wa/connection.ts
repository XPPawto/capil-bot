import type { Boom } from "@hapi/boom";
import { prisma } from "@kelurahan/db";
import { logger } from "../logger";
import { waState } from "./state";

const BACKOFF_SCHEDULE_MS = [2000, 5000, 15000, 30000];

export function getBackoffDelay(): number {
  const idx = Math.min(waState.reconnectAttempt, BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[idx];
}

export function getDisconnectStatusCode(lastDisconnect: { error?: unknown } | undefined): number | undefined {
  const err = lastDisconnect?.error as Boom | undefined;
  return err?.output?.statusCode;
}

export async function markBotConnected(waJid: string | undefined, phoneNumber: string | undefined): Promise<void> {
  await prisma.botSession.upsert({
    where: { id: 1 },
    update: { waJid, phoneNumber, connected: true, lastConnectedAt: new Date() },
    create: { id: 1, waJid, phoneNumber, connected: true, lastConnectedAt: new Date() },
  });
  logger.info({ waJid, phoneNumber }, "Bot WA terhubung");
}

export async function markBotDisconnected(): Promise<void> {
  await prisma.botSession.upsert({
    where: { id: 1 },
    update: { connected: false },
    create: { id: 1, connected: false },
  });
}
