import { downloadMediaMessage, extractMessageContent } from "@whiskeysockets/baileys";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { logger } from "../logger";
import { config } from "../config";

/**
 * Notifikasi Telegram khusus permintaan pemilik - kirim pemberitahuan tiap ada AKTIVITAS
 * CHAT (masuk MAUPUN keluar - lihat ChatEventKind) untuk SATU akun ekstra tertentu saja:
 * "Akun Kedua" (628218559216, ExtraAccount.id = 1 pada database saat fitur ini dibuat).
 * Sengaja tidak berlaku untuk nomor layanan maupun akun ekstra lain. Foto/video/voice note
 * DITERUSKAN sungguhan (bukan cuma label teks) - kecuali foto/video "sekali lihat", yang
 * SENGAJA tetap tidak pernah diunduh/diteruskan ke mana pun, sama seperti alasan di
 * media/inboxMedia.ts (menghormati niat privasi pengirim).
 *
 * Best-effort murni: gagal kirim ke Telegram (token salah, chat_id salah, Telegram down,
 * media gagal diteruskan, dsb) TIDAK BOLEH mengganggu pencatatan pesan ke /admin-xpawto
 * maupun pengiriman balasan WA yang sesungguhnya - cuma dicatat sebagai warning di log.
 */
const TELEGRAM_NOTIFY_ACCOUNT_ID = 1;

/**
 * "inbound" - chat baru dari warga/orang lain (masuk).
 * "outbound_dashboard" - balasan yang KITA kirim lewat halaman /admin-xpawto.
 * "outbound_device" - balasan yang diketik LANGSUNG dari HP akun ini (bukan lewat dashboard).
 */
export type ChatEventKind = "inbound" | "outbound_dashboard" | "outbound_device";

interface ChatMeta {
  isGroup?: boolean;
  isChannel?: boolean;
  groupName?: string;
  senderName?: string;
  senderNumber?: string;
  waNumber: string;
}

function buildHeader(kind: ChatEventKind, meta: ChatMeta): string {
  if (kind === "outbound_dashboard") return `✅ Balasan terkirim lewat dashboard (Akun Kedua)\nKe: ${meta.waNumber}`;
  if (kind === "outbound_device") return `\u{1F4F1} Balasan dari HP (Akun Kedua)\nKe: ${meta.waNumber}`;
  if (meta.isChannel) return `\u{1F4E2} Postingan channel baru (Akun Kedua)\nChannel: ${meta.groupName ?? "-"}`;
  if (meta.isGroup) {
    return `\u{1F4AC} Chat grup baru (Akun Kedua)\nGrup: ${meta.groupName ?? "-"}\nDari: ${meta.senderName ?? meta.senderNumber ?? "-"}`;
  }
  return `\u{1F4AC} Chat baru (Akun Kedua)\nDari: ${meta.senderName ? `${meta.senderName} (${meta.waNumber})` : meta.waNumber}`;
}

function isTelegramEnabled(accountId: number): { botToken: string; chatId: string } | null {
  if (accountId !== TELEGRAM_NOTIFY_ACCOUNT_ID) return null;
  const { botToken, notifyChatId } = config.telegram;
  if (!botToken || !notifyChatId) return null;
  return { botToken, chatId: notifyChatId };
}

async function sendTelegramText(botToken: string, chatId: string, message: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message.slice(0, 4000) }),
  });
  if (!res.ok) {
    const responseBody = await res.text().catch(() => "");
    throw new Error(`Telegram sendMessage gagal (${res.status}): ${responseBody}`);
  }
}

type MediaKind = "photo" | "video" | "voice" | "audio" | "document";

function pickMediaKind(mimeType: string, ptt: boolean): MediaKind {
  if (mimeType.startsWith("image/")) return "photo";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return ptt ? "voice" : "audio";
  return "document";
}

const TELEGRAM_METHOD_BY_KIND: Record<MediaKind, { method: string; field: string; fileName: string }> = {
  photo: { method: "sendPhoto", field: "photo", fileName: "media.jpg" },
  video: { method: "sendVideo", field: "video", fileName: "media.mp4" },
  voice: { method: "sendVoice", field: "voice", fileName: "voice.ogg" },
  audio: { method: "sendAudio", field: "audio", fileName: "audio.ogg" },
  document: { method: "sendDocument", field: "document", fileName: "file" },
};

/**
 * Kirim buffer media apa adanya ke Telegram - dipakai baik dari pesan WA asli (lewat
 * forwardTelegramChatActivity, ada `ptt`/`fileName` dari metadata WA) maupun dari file yang
 * ADMIN kirim sendiri lewat dashboard (notify/sendInboxFile.ts, tidak ada metadata WA sama
 * sekali, cuma mimetype hasil deteksi magic-byte).
 */
export async function sendTelegramMediaBuffer(
  accountId: number,
  buffer: Buffer,
  mimeType: string,
  caption: string,
  opts?: { ptt?: boolean; fileName?: string }
): Promise<void> {
  const creds = isTelegramEnabled(accountId);
  if (!creds) return;

  const kind = pickMediaKind(mimeType, opts?.ptt ?? false);
  const spec = TELEGRAM_METHOD_BY_KIND[kind];
  const fileName = opts?.fileName || spec.fileName;

  const form = new FormData();
  form.append("chat_id", creds.chatId);
  form.append("caption", caption.slice(0, 1000));
  form.append(spec.field, new Blob([buffer]), fileName);

  const res = await fetch(`https://api.telegram.org/bot${creds.botToken}/${spec.method}`, { method: "POST", body: form });
  if (!res.ok) {
    const responseBody = await res.text().catch(() => "");
    throw new Error(`Telegram ${spec.method} gagal (${res.status}): ${responseBody}`);
  }
}

/**
 * Titik masuk utama untuk pesan WA ASLI (event messages.upsert, punya WAMessage lengkap) -
 * dipakai conversation/extraAccountMessageHandler.ts untuk pesan MASUK dan balasan yang
 * diketik langsung dari HP. Balasan lewat dashboard (tidak ada WAMessage, cuma teks/file
 * bebas dari admin) pakai jalur terpisah: notifyTelegramChatEvent (teks) atau
 * sendTelegramMediaBuffer (file) langsung dari notify/sendInboxReply.ts & sendInboxFile.ts.
 */
export async function forwardTelegramChatActivity(
  sock: WASocket,
  msg: WAMessage,
  accountId: number,
  kind: ChatEventKind,
  text: string | undefined,
  meta: ChatMeta
): Promise<void> {
  const creds = isTelegramEnabled(accountId);
  if (!creds) return;

  const header = buildHeader(kind, meta);

  const raw = msg.message;
  const m = raw ? (extractMessageContent(raw) ?? raw) : undefined;
  const isImage = Boolean(m?.imageMessage);
  const isVideo = Boolean(m?.videoMessage);
  const isAudio = Boolean(m?.audioMessage);
  const isSticker = Boolean(m?.stickerMessage);
  const isDocument = Boolean(m?.documentMessage);

  // Sama seperti media/inboxMedia.ts - "sekali lihat" ditandai lewat DUA cara berbeda
  // tergantung versi klien pengirim, keduanya wajib dicek. SENGAJA tidak pernah diunduh -
  // cukup dikabari lewat teks bahwa ada kiriman semacam itu.
  const isViewOnceWrapper = Boolean(raw?.viewOnceMessage || raw?.viewOnceMessageV2 || raw?.viewOnceMessageV2Extension);
  const isViewOnceFlag = Boolean((isImage && m?.imageMessage?.viewOnce) || (isVideo && m?.videoMessage?.viewOnce));
  if ((isImage || isVideo) && (isViewOnceWrapper || isViewOnceFlag)) {
    const label = isImage ? "[Foto sekali lihat - tidak diteruskan]" : "[Video sekali lihat - tidak diteruskan]";
    await sendTelegramText(creds.botToken, creds.chatId, `${header}\n\n${label}`);
    return;
  }

  if (isImage || isVideo || isAudio || isSticker || isDocument) {
    try {
      const buffer = (await downloadMediaMessage(
        msg,
        "buffer",
        {},
        { logger: logger.child({ module: "telegram-media" }) as any, reuploadRequest: sock.updateMediaMessage }
      )) as Buffer;
      const caption = `${header}${text ? `\n\n${text}` : ""}`;
      const mimeType = isImage
        ? "image/jpeg"
        : isVideo
          ? "video/mp4"
          : isAudio
            ? "audio/ogg"
            : isSticker
              ? "image/webp"
              : (m?.documentMessage?.mimetype ?? "application/octet-stream");
      await sendTelegramMediaBuffer(accountId, buffer, mimeType, caption, {
        ptt: m?.audioMessage?.ptt ?? false,
        fileName: m?.documentMessage?.fileName ?? undefined,
      });
      return;
    } catch (err) {
      logger.warn({ err, accountId }, "Gagal meneruskan media ke Telegram, kirim notifikasi teks saja sebagai gantinya");
      // lanjut ke notifikasi teks biasa di bawah sebagai fallback, bukan diam-diam gagal total
    }
  }

  const bodyText = text?.trim() || "[Pesan tanpa teks]";
  await sendTelegramText(creds.botToken, creds.chatId, `${header}\n\n${bodyText}`);
}

/** Dipakai notify/sendInboxReply.ts untuk balasan TEKS lewat dashboard (tidak ada file). */
export async function notifyTelegramChatEvent(
  accountId: number,
  opts: { kind: ChatEventKind; waNumber: string; text: string }
): Promise<void> {
  const creds = isTelegramEnabled(accountId);
  if (!creds) return;
  await sendTelegramText(creds.botToken, creds.chatId, `${buildHeader(opts.kind, { waNumber: opts.waNumber })}\n\n${opts.text}`);
}
