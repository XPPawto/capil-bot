import { downloadMediaMessage, extractMessageContent } from "@whiskeysockets/baileys";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { logger } from "../logger";
import { config } from "../config";

/**
 * Notifikasi Telegram khusus permintaan pemilik - kirim pemberitahuan tiap ada AKTIVITAS
 * CHAT (masuk MAUPUN keluar - lihat ChatEventKind) untuk SATU akun ekstra tertentu saja:
 * "Akun Kedua" (628218559216, ExtraAccount.id = 1 pada database saat fitur ini dibuat).
 * Sengaja tidak berlaku untuk nomor layanan maupun akun ekstra lain. Foto/video/voice note
 * DITERUSKAN sungguhan (bukan cuma label teks) - kecuali kiriman "sekali lihat", yang cuma
 * dikabari lewat teks. Untuk varian yang paling umum sekarang, itu memang satu-satunya
 * pilihan: WhatsApp tidak pernah mengirim isinya ke perangkat tertaut, jadi tidak ada apa
 * pun yang bisa diteruskan (penjelasan lengkap di media/inboxMedia.ts ->
 * logViewOnceUnavailableNote). Notifikasinya dikirim dari extraAccountMessageHandler.ts
 * lewat notifyTelegramChatEvent, bukan dari sini - pesan semacam itu berhenti jauh sebelum
 * sampai ke forwardTelegramChatActivity karena isinya kosong.
 *
 * Best-effort murni: gagal kirim ke Telegram (token salah, chat_id salah, Telegram down,
 * media gagal diteruskan, dsb) TIDAK BOLEH mengganggu pencatatan pesan ke /admin-xpawto
 * maupun pengiriman balasan WA yang sesungguhnya - cuma dicatat sebagai warning di log.
 */
export const TELEGRAM_NOTIFY_ACCOUNT_ID = 1;

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

/**
 * PENTING (permintaan pemilik: notifikasi Telegram "berantakan banget kalau chatnya lagi
 * rame, bikin pusing") - dua masalah nyata di format LAMA:
 *  1. Setiap notifikasi selalu 3+ baris (header 2 baris + baris kosong + isi) padahal SEMUA
 *     notifikasi di sini SUDAH PASTI dari akun yang sama ("Akun Kedua", TELEGRAM_NOTIFY_
 *     ACCOUNT_ID di atas) - label itu diulang di HAMPIR SETIAP baris tanpa pernah berubah,
 *     murni pemborosan ruang layar yang tidak menyampaikan informasi baru apa pun.
 *  2. Kalau ada beberapa percakapan aktif BERGANTIAN dalam waktu berdekatan (skenario
 *     "rame" yang dikeluhkan), pesannya jadi satu aliran panjang tanpa penanda visual mana
 *     yang dari siapa - mata harus baca ulang tiap baris "Dari:"/"Ke:" satu-satu.
 *
 * Solusi TANPA infrastruktur baru (bukan pindah ke grup Forum Telegram, yang butuh setup
 * manual pemilik - lihat percakapan fitur ini): tag warna deterministik per percakapan
 * (conversationTag) supaya mata bisa cepat mengelompokkan notifikasi yang berdekatan tanpa
 * baca ulang nama, DITAMBAH header lengkap (nama/nomor) cuma diulang kalau percakapannya
 * benar-benar GANTI dari notifikasi sebelumnya (shouldShowFullHeader) - beberapa pesan
 * beruntun dari orang yang SAMA jadi jauh lebih ringkas, persis bagaimana aplikasi chat asli
 * mengelompokkan bubble tanpa mengulang avatar/nama tiap baris.
 */
const CONVERSATION_TAGS = ["🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "🟫", "⬛", "⬜"];
function conversationTag(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return CONVERSATION_TAGS[hash % CONVERSATION_TAGS.length];
}

function conversationKey(meta: ChatMeta): string {
  if (meta.isChannel) return `channel:${meta.groupName ?? "-"}`;
  if (meta.isGroup) return `group:${meta.groupName ?? "-"}`;
  return `dm:${meta.waNumber}`;
}

// Jeda sebelum header lengkap ditampilkan ulang WALAU percakapannya sama persis dengan
// notifikasi sebelumnya - supaya percakapan yang sempat lama tidak aktif tidak muncul lagi
// tanpa konteks nama/nomor sama sekali kalau tiba-tiba aktif lagi setelah jeda panjang.
const HEADER_REPEAT_WINDOW_MS = 90_000;
// State ini SENGAJA murni in-memory (bukan disimpan ke DB) - sama seperti presence, cuma
// mempengaruhi TAMPILAN notifikasi berikutnya, tidak ada nilai historis untuk diaudit.
// Per accountId walau saat ini cuma accountId 1 yang pernah benar-benar lewat sini.
const lastNotified = new Map<number, { key: string; at: number }>();

function shouldShowFullHeader(accountId: number, key: string): boolean {
  const last = lastNotified.get(accountId);
  lastNotified.set(accountId, { key, at: Date.now() });
  return !last || last.key !== key || Date.now() - last.at > HEADER_REPEAT_WINDOW_MS;
}

function directionMark(kind: ChatEventKind): string {
  if (kind === "outbound_dashboard") return "✅ ";
  if (kind === "outbound_device") return "\u{1F4F1} ";
  return "";
}

interface HeaderResult {
  text: string;
  // Header super pendek (cuma tag warna, atau tag + penanda arah) - digabung SATU baris
  // dengan isi pesannya (lihat composeMessage) supaya tidak ada baris terbuang cuma untuk
  // menampilkan 1-2 karakter tag doang. Header yang masih ada nama/nomor tetap baris sendiri
  // (lebih enak dipindai kalau ini memang notifikasi "kartu baru").
  oneLine: boolean;
}

function buildHeader(accountId: number, kind: ChatEventKind, meta: ChatMeta): HeaderResult {
  const key = conversationKey(meta);
  const tag = conversationTag(key);
  const mark = directionMark(kind);
  const showFull = shouldShowFullHeader(accountId, key);

  if (meta.isChannel) {
    return showFull
      ? { text: `${tag} \u{1F4E2} ${meta.groupName ?? "Channel"}`, oneLine: false }
      : { text: tag, oneLine: true };
  }
  if (meta.isGroup) {
    // Nama grup cuma diulang kalau grupnya beda dari notifikasi sebelumnya - siapa yang
    // bicara TETAP selalu ditampilkan (satu grup bisa banyak pengirim berbeda-beda, beda
    // dari chat 1:1 di bawah yang lawan bicaranya cuma satu orang, aman disingkat total).
    const who = kind === "inbound" ? (meta.senderName ?? meta.senderNumber ?? "-") : "Anda";
    return showFull
      ? { text: `${tag} \u{1F465} ${meta.groupName ?? "Grup"} \u{00B7} ${who}`, oneLine: false }
      : { text: `${tag} ${who}:`, oneLine: true };
  }
  if (!showFull) return { text: `${tag} ${mark}`.trimEnd(), oneLine: true };
  const who = meta.senderName ? `${meta.senderName} (${meta.waNumber})` : meta.waNumber;
  return { text: `${tag} ${mark}${who}`.trimEnd(), oneLine: false };
}

function composeMessage(header: HeaderResult, body: string): string {
  return header.oneLine ? `${header.text} ${body}` : `${header.text}\n${body}`;
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

  const header = buildHeader(accountId, kind, meta);

  const raw = msg.message;
  const m = raw ? (extractMessageContent(raw) ?? raw) : undefined;
  const isImage = Boolean(m?.imageMessage);
  const isVideo = Boolean(m?.videoMessage);
  const isAudio = Boolean(m?.audioMessage);
  const isSticker = Boolean(m?.stickerMessage);
  const isDocument = Boolean(m?.documentMessage);
  // Video note (video bulat) - tipe pesan tersendiri di WhatsApp, lihat media/inboxMedia.ts.
  const isPtv = Boolean(m?.ptvMessage);

  // Cabang ini cuma tercapai untuk varian "sekali lihat" yang isinya SUNGGUHAN ikut terkirim
  // (klien WA lama: flag viewOnce di dalam imageMessage/videoMessage, atau wrapper
  // viewOnceMessage* - keduanya wajib dicek karena beda versi pengirim). Beda dari
  // media/inboxMedia.ts yang kini menyimpan isinya ke Pesan Masuk, ke Telegram SENGAJA cuma
  // dikirim labelnya: meneruskan isinya berarti menyalurkan kiriman sensitif ke layanan
  // pihak ketiga, satu langkah lebih jauh daripada menyimpannya di server sendiri.
  const isViewOnceWrapper = Boolean(raw?.viewOnceMessage || raw?.viewOnceMessageV2 || raw?.viewOnceMessageV2Extension);
  const isViewOnceFlag = Boolean((isImage && m?.imageMessage?.viewOnce) || (isVideo && m?.videoMessage?.viewOnce));
  if ((isImage || isVideo) && (isViewOnceWrapper || isViewOnceFlag)) {
    const label = isImage ? "[Foto sekali lihat - tidak diteruskan]" : "[Video sekali lihat - tidak diteruskan]";
    await sendTelegramText(creds.botToken, creds.chatId, composeMessage(header, label));
    return;
  }

  if (isImage || isVideo || isAudio || isSticker || isDocument || isPtv) {
    try {
      const buffer = (await downloadMediaMessage(
        msg,
        "buffer",
        {},
        { logger: logger.child({ module: "telegram-media" }) as any, reuploadRequest: sock.updateMediaMessage }
      )) as Buffer;
      const caption = text ? composeMessage(header, text) : header.text;
      // Video note diteruskan lewat sendVideo biasa (video/mp4), BUKAN sendVideoNote milik
      // Telegram yang bentuknya memang lebih mirip: metode itu tidak menerima caption sama
      // sekali, sehingga keterangan siapa pengirimnya - justru inti notifikasi ini - akan
      // hilang. Isinya tetap utuh, cuma tampil kotak, bukan bulat.
      const mimeType = isImage
        ? "image/jpeg"
        : isVideo || isPtv
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
  await sendTelegramText(creds.botToken, creds.chatId, composeMessage(header, bodyText));
}

/**
 * Notifikasi TEKS murni - dipakai notify/sendInboxReply.ts untuk balasan lewat dashboard
 * (tidak ada file), dan untuk kiriman yang isinya memang tidak pernah kita terima sehingga
 * tidak ada apa pun yang bisa diteruskan (kiriman "sekali lihat", lihat
 * media/inboxMedia.ts -> logViewOnceUnavailableNote).
 *
 * `meta` opsional: balasan dashboard selalu chat 1:1 sehingga cukup nomornya saja, tapi
 * pemanggil yang berasal dari pesan WA asli bisa datang dari grup/channel - tanpa meta,
 * header-nya akan salah menyebutnya sebagai chat pribadi.
 */
export async function notifyTelegramChatEvent(
  accountId: number,
  opts: { kind: ChatEventKind; waNumber: string; text: string; meta?: Omit<ChatMeta, "waNumber"> }
): Promise<void> {
  const creds = isTelegramEnabled(accountId);
  if (!creds) return;
  const header = buildHeader(accountId, opts.kind, { ...opts.meta, waNumber: opts.waNumber });
  await sendTelegramText(creds.botToken, creds.chatId, composeMessage(header, opts.text));
}

/** Reaksi emoji ke pesan (💗👍😂 dst) - emoji kosong berarti reaksinya dibatalkan. Dipanggil
 * dari extraAccountMessageHandler.ts, terpisah dari forwardTelegramChatActivity karena
 * reactionMessage bukan "chat baru" biasa (tidak ada isinya untuk diunduh/diteruskan).
 *
 * `attached` = apakah reaksinya berhasil ditempelkan ke pesan yang benar-benar ada di
 * /admin-xpawto. Bisa `false` kalau pesan aslinya tidak pernah tersimpan di InboxMessage
 * (mis. gagal decrypt sesi WA saat pesan itu pertama masuk) - tanpa penanda ini, notifikasi
 * Telegram terkesan "berhasil" padahal di website tidak akan muncul apa-apa, membingungkan. */
export async function notifyTelegramReaction(
  accountId: number,
  opts: { waNumber: string; reactorName: string; emoji: string; isGroup?: boolean; groupName?: string; attached: boolean }
): Promise<void> {
  const creds = isTelegramEnabled(accountId);
  if (!creds) return;
  const tag = conversationTag(opts.isGroup ? `group:${opts.groupName ?? "-"}` : `dm:${opts.waNumber}`);
  const target = opts.isGroup ? `grup ${opts.groupName ?? "-"}` : opts.waNumber;
  const text = opts.emoji
    ? `${tag} ${opts.emoji} Reaksi dari ${opts.reactorName} \u{00B7} ${target}`
    : `${tag} Reaksi dibatalkan \u{00B7} ${opts.reactorName} \u{00B7} ${target}`;
  const note = opts.attached
    ? ""
    : "\n⚠️ Pesan aslinya tidak tersimpan di Pesan Masuk (kemungkinan gagal ter-sinkron saat masuk), jadi reaksi ini TIDAK akan tampil di /admin-xpawto.";
  await sendTelegramText(creds.botToken, creds.chatId, `${text}${note}`);
}
