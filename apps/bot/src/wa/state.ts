import type { WASocket } from "@whiskeysockets/baileys";

interface WaRuntimeState {
  sock: WASocket | null;
  isConnecting: boolean;
  connected: boolean;
  qrDataUrl: string | null;
  pairingCode: string | null;
  pendingPairingNumber: string | null;
  reconnectAttempt: number;
}

/**
 * In-memory only. QR/pairing code are ephemeral and never persisted to DB
 * (they rotate every ~20s); only durable connection status lives in BotSession.
 */
export const waState: WaRuntimeState = {
  sock: null,
  isConnecting: false,
  connected: false,
  qrDataUrl: null,
  pairingCode: null,
  pendingPairingNumber: null,
  reconnectAttempt: 0,
};
