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
 * State runtime untuk nomor KEDUA (perangkat tertaut manual, bukan bot layanan) - struktur
 * identik dengan wa/state.ts, sengaja dipisah bukan digabung jadi satu Map supaya kode yang
 * sudah teruji untuk nomor layanan (wa/socket.ts dkk) tidak perlu disentuh sama sekali.
 */
export const secondaryWaState: WaRuntimeState = {
  sock: null,
  isConnecting: false,
  connected: false,
  qrDataUrl: null,
  pairingCode: null,
  pendingPairingNumber: null,
  reconnectAttempt: 0,
};
