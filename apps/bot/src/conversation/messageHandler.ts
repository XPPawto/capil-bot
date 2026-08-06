import { extractMessageContent, proto, type WAMessage, type WASocket } from "@whiskeysockets/baileys";
import type { InboxChannel } from "@kelurahan/db";
import { logger } from "../logger";
import { handleConversationMessage } from "./handler";
import { runExclusive } from "./mutex";
import { checkRateLimit } from "./rateLimit";
import { humanSendMessage } from "../wa/humanSend";
import { isHumanTakeoverActive } from "./humanTakeover";
import {
  applyMessageEdit,
  logInboundIfActiveRequest,
  logInboxMessage,
  logOutboundFromDevice,
  resolveKnownWaNumber,
  updateMessageStatus,
  type GroupMeta,
} from "./messageLog";
import { handleVoiceNote } from "../media/voiceNote";
import { logInboxMediaIfPresent, logViewOnceUnavailableNote } from "../media/inboxMedia";
import { getGroupName } from "../wa/groupNameCache";
import { getChannelName } from "../wa/channelNameCache";
import { wasSentByDashboard } from "../wa/sentMessageTracker";

interface MessagesUpsertPayload {
  messages: WAMessage[];
  type: string;
}

/**
 * WhatsApp kadang mengalamatkan kontak lewat "LID" (linked ID) yang tidak berkorelasi
 * dengan nomor HP-nya sama sekali (mis. remoteJid "82802724872358@lid") - fitur privasi
 * WhatsApp yang menyembunyikan nomor asli di balik ID internal. Kalau itu terjadi, Baileys
 * tetap menyertakan nomor asli di msg.key.senderPn ("62xxxxxxxxxx@s.whatsapp.net"). Ambil
 * dari situ dulu supaya yang tersimpan/ditampilkan ke petugas nomor HP sungguhan, bukan ID
 * internal. waJid untuk membalas pesan tetap pakai remoteJid asli (jangan diubah) - WhatsApp
 * mengharuskan alamat balasan sama persis dengan yang dipakai kontak untuk mengirim.
 */
export function extractWaNumber(msg: WAMessage, jid: string): string {
  const senderPn = msg.key.senderPn;
  if (senderPn) {
    return senderPn.split("@")[0];
  }
  return jid.split("@")[0];
}

/**
 * Sama seperti extractWaNumber tapi untuk PENGIRIM di dalam grup (msg.key.participant),
 * bukan lawan bicara di percakapan langsung (msg.key.remoteJid).
 */
export function extractParticipantNumber(msg: WAMessage): string | undefined {
  const participantPn = msg.key.participantPn;
  if (participantPn) return participantPn.split("@")[0];
  return msg.key.participant?.split("@")[0];
}

export function extractText(msg: WAMessage): string | undefined {
  const raw = msg.message;
  if (!raw) return undefined;
  // Buka bungkus documentWithCaptionMessage/viewOnceMessage dkk dulu, sama seperti
  // di media/download.ts, supaya caption pada dokumen terbungkus tetap terbaca.
  const m = extractMessageContent(raw) ?? raw;
  return m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.documentMessage?.caption ?? undefined;
}

function formatLocationText(loc: { degreesLatitude?: number | null; degreesLongitude?: number | null; name?: string | null; address?: string | null }): string | undefined {
  const { degreesLatitude: lat, degreesLongitude: lng, name, address } = loc;
  if (lat == null || lng == null) return undefined;
  const parts = ["[Lokasi]"];
  if (name) parts.push(name);
  if (address) parts.push(address);
  parts.push(`https://maps.google.com/?q=${lat},${lng}`);
  return parts.join("\n");
}

function formatLiveLocationText(loc: { degreesLatitude?: number | null; degreesLongitude?: number | null; caption?: string | null }): string | undefined {
  const { degreesLatitude: lat, degreesLongitude: lng, caption } = loc;
  if (lat == null || lng == null) return undefined;
  const parts = ["[Live Location]"];
  if (caption) parts.push(caption);
  parts.push(`https://maps.google.com/?q=${lat},${lng}`);
  return parts.join("\n");
}

/**
 * Sama seperti extractText, TAPI juga mengenali share lokasi/live location - dipakai
 * KHUSUS untuk pencatatan ke Pesan Masuk (/admin-xpawto), BUKAN untuk input ke alur bot
 * (handleConversationMessage tetap pakai extractText polos) - supaya warga yang berbagi
 * lokasi di tengah alur formulir tidak keliru dianggap "mengetik" teks itu sebagai
 * jawaban nama/dsb oleh mesin percakapan.
 */
export function extractInboxText(msg: WAMessage): string | undefined {
  const plain = extractText(msg);
  if (plain) return plain;
  const raw = msg.message;
  if (!raw) return undefined;
  const m = extractMessageContent(raw) ?? raw;
  if (m.locationMessage) return formatLocationText(m.locationMessage);
  if (m.liveLocationMessage) return formatLiveLocationText(m.liveLocationMessage);
  return undefined;
}

/**
 * Nomor HP untuk pesan fromMe/balasan-dari-HP (kita yang MENGIRIM, bukan menerima) - beda
 * dari extractWaNumber yang mengandalkan senderPn (itu cuma ada untuk pesan MASUK). Kalau
 * remoteJid warga di-mask WhatsApp sebagai "@lid", jid.split("@")[0] menghasilkan ID
 * internal WhatsApp yang panjang & bukan nomor HP asli (bug yang bikin /admin-xpawto
 * menampilkan angka aneh) - di sini diutamakan nomor yang SUDAH PERNAH terbukti benar dari
 * histori percakapan (resolveKnownWaNumber), baru kalau belum ada histori sama sekali
 * (warga belum pernah chat, admin chat duluan) dicoba onWhatsApp() sebagai upaya terakhir.
 */
export async function resolveWaNumberForOutbound(sock: WASocket, jid: string): Promise<string> {
  const known = await resolveKnownWaNumber(jid);
  if (known) return known;

  if (jid.endsWith("@lid")) {
    try {
      const results = await sock.onWhatsApp(jid);
      const resolvedJid = results?.[0]?.jid;
      if (resolvedJid && resolvedJid.endsWith("@s.whatsapp.net")) {
        return resolvedJid.split("@")[0];
      }
    } catch (err) {
      logger.warn({ err, jid }, "Gagal resolusi nomor asli lewat onWhatsApp, pakai fallback JID mentah");
    }
  }

  return jid.split("@")[0];
}

/**
 * Kalau pesan ini adalah EDIT (WhatsApp mengirim protocolMessage tipe MESSAGE_EDIT saat
 * siapa pun - warga atau kita sendiri - mengedit pesan yang sudah terkirim sebelumnya),
 * cari baris yang tepat lewat waMessageId (ID pesan ASLI, dari protocolMessage.key.id) dan
 * update isinya DI TEMPAT lewat applyMessageEdit - HANYA baris itu yang tersentuh, tidak
 * ada baris lain yang ikut berubah. Kembalikan true kalau ini memang event edit (supaya
 * pemanggil tahu harus berhenti di sini, bukan diproses lagi sebagai pesan baru biasa).
 */
export async function handleMessageEditIfPresent(
  msg: WAMessage,
  jid: string,
  channel: InboxChannel,
  extraAccountId?: number
): Promise<boolean> {
  const protocolMsg = msg.message?.protocolMessage;
  if (!protocolMsg) return false;

  // Log diagnostik sementara - protocolMessage dipakai WA untuk banyak jenis event (revoke,
  // reaksi, sync, dst), bukan cuma edit. Kalau ternyata edit tidak konsisten kedeteksi,
  // ini membantu lihat tipe apa yang sungguh datang tanpa perlu menebak-nebak lagi.
  if (protocolMsg.type !== proto.Message.ProtocolMessage.Type.MESSAGE_EDIT) {
    logger.info({ jid, protocolType: protocolMsg.type }, "protocolMessage diterima, bukan MESSAGE_EDIT - diabaikan");
    return false;
  }

  const originalId = protocolMsg.key?.id;
  if (!originalId) {
    logger.warn({ jid }, "Event MESSAGE_EDIT diterima tapi tidak ada key.id target - diabaikan");
    return true;
  }

  const editedContent = extractMessageContent(protocolMsg.editedMessage ?? undefined) ?? protocolMsg.editedMessage;
  const newText = editedContent?.conversation ?? editedContent?.extendedTextMessage?.text;
  if (!newText) {
    logger.warn({ jid, originalId, editedContent }, "Event MESSAGE_EDIT diterima tapi tidak ada teks baru yang dikenali");
    return true;
  }

  try {
    const applied = await applyMessageEdit(jid, originalId, newText, channel, extraAccountId);
    logger.info({ jid, originalId, channel, extraAccountId, applied, newText }, "Edit pesan diproses");
  } catch (err) {
    logger.error({ err, jid, originalId }, "Gagal menerapkan edit pesan");
  }
  return true;
}

/**
 * Event centang WA (messages.update) - dikirim WhatsApp saat status pengiriman pesan KELUAR
 * berubah (terkirim ke server -> sampai HP lawan bicara -> dibaca/diputar). Cuma relevan
 * untuk pesan `fromMe` (yang KITA kirim) - status pesan MASUK tidak bermakna apa-apa di sini.
 * Dipakai bareng oleh nomor layanan (SERVICE, socket.ts) dan tiap akun ekstra (EXTRA,
 * extraAccountManager.ts) lewat parameter channel/extraAccountId, sama seperti
 * handleMessageEditIfPresent.
 */
export async function handleMessageStatusUpdates(
  updates: { key: proto.IMessageKey; update: Partial<proto.IWebMessageInfo> }[],
  channel: InboxChannel,
  extraAccountId?: number
): Promise<void> {
  for (const { key, update } of updates) {
    if (!key.fromMe || !key.remoteJid || !key.id) continue;
    const status = update.status;
    if (status == null) continue;

    let mapped: "SENT" | "DELIVERED" | "READ" | undefined;
    if (status === proto.WebMessageInfo.Status.READ || status === proto.WebMessageInfo.Status.PLAYED) {
      mapped = "READ";
    } else if (status === proto.WebMessageInfo.Status.DELIVERY_ACK) {
      mapped = "DELIVERED";
    } else if (
      status === proto.WebMessageInfo.Status.SERVER_ACK ||
      status === proto.WebMessageInfo.Status.PENDING
    ) {
      mapped = "SENT";
    }
    if (!mapped) continue;

    try {
      await updateMessageStatus(key.remoteJid, key.id, mapped, channel, extraAccountId);
    } catch (err) {
      logger.warn({ err, jid: key.remoteJid, waMessageId: key.id }, "Gagal memperbarui status centang pesan");
    }
  }
}

export async function handleIncomingMessages(sock: WASocket, payload: MessagesUpsertPayload): Promise<void> {
  // Event edit pesan (protocolMessage) kadang datang dengan payload.type "append", bukan
  // "notify" - kalau langsung berhenti di sini untuk apa pun selain "notify", semua edit
  // akan diam-diam terlewat tanpa diproses sama sekali. "notify"/"append" tetap diperiksa
  // untuk kemungkinan edit di bawah; pemrosesan pesan BARU biasa (alur bot dst) tetap
  // dibatasi cuma untuk "notify" saja (lihat pengecekan kedua di dalam loop).
  if (payload.type !== "notify" && payload.type !== "append") return;

  for (const msg of payload.messages) {
    const jid = msg.key.remoteJid;
    if (!jid) continue;
    // "@newsletter" = Channel WhatsApp (siaran satu-arah, bukan percakapan dengan orang
    // tertentu) - tidak relevan buat kotak masuk, diskip sama seperti broadcast/status.
    if (jid === "status@broadcast" || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) continue;

    // Sama seperti di extraAccountMessageHandler.ts: kiriman "sekali lihat" datang sebagai
    // amplop KOSONG, jadi harus dicatat SEBELUM pagar `!msg.message` di bawah - kalau tidak,
    // warga yang mengirim foto sekali-lihat ke nomor layanan hilang jejaknya sama sekali.
    // Syarat `!msg.message` menjaga agar kiriman susulan dari HP (kalau permintaan kirim-ulang
    // otomatis Baileys akhirnya dijawab) tetap lewat jalur media biasa, bukan dibuang di sini.
    if (msg.key.isViewOnce && !msg.message) {
      const isGroupChat = jid.endsWith("@g.us");
      const senderNumber = isGroupChat && !msg.key.fromMe ? extractParticipantNumber(msg) : undefined;
      const noteWaNumber = isGroupChat
        ? (senderNumber ?? jid.split("@")[0])
        : msg.key.fromMe
          ? await resolveWaNumberForOutbound(sock, jid)
          : extractWaNumber(msg, jid);
      const noteGroup: GroupMeta | undefined = isGroupChat
        ? {
            isGroup: true,
            groupName: await getGroupName(sock, jid),
            senderNumber,
            senderName: msg.key.fromMe ? undefined : (msg.pushName ?? undefined),
          }
        : undefined;
      await logViewOnceUnavailableNote(
        jid,
        noteWaNumber,
        "SERVICE",
        noteGroup,
        msg.key.fromMe ? "OUTBOUND" : "INBOUND",
        undefined,
        msg.key.id ?? undefined
      );
      continue;
    }

    if (!msg.message) continue;

    if (await handleMessageEditIfPresent(msg, jid, "SERVICE")) continue;

    // Selain edit (ditangani di atas), sisa alur di bawah ini HANYA untuk payload "notify"
    // (pesan baru sungguhan) - "append" bisa berisi event lain yang bukan pesan baru dan
    // salah kalau ikut diproses sebagai input warga/alur bot.
    if (payload.type !== "notify") continue;

    // ---- Pesan yang KITA kirim sendiri (fromMe) ----
    // humanSendMessage (wa/humanSend.ts) menandai SETIAP pesan yang dikirim lewat kode
    // kita sendiri - baik balasan otomatis bot, balasan admin dari dashboard, notifikasi
    // status, dst - ke sentMessageTracker SEBELUM benar-benar dikirim. Kalau ID pesan ini
    // ada di situ, ini cuma echo dari pesan yang memang sudah kita catat sendiri di jalur
    // lain -> dilewati supaya tidak dobel. Kalau TIDAK ada, berarti ini diketik LANGSUNG
    // dari HP nomor bot (bukan lewat kode kita sama sekali) -> direkam sebagai balasan baru
    // supaya kelihatan juga di /admin-xpawto, lalu dihentikan (bukan input warga, tidak
    // perlu diproses alur menu/formulir).
    if (msg.key.fromMe) {
      if (wasSentByDashboard(msg.key.id)) continue;

      const isGroup = jid.endsWith("@g.us");
      const waNumber = isGroup ? jid.split("@")[0] : await resolveWaNumberForOutbound(sock, jid);
      const text = extractInboxText(msg);
      const group: GroupMeta | undefined = isGroup
        ? { isGroup: true, groupName: await getGroupName(sock, jid) }
        : undefined;

      try {
        if (text) await logOutboundFromDevice(jid, waNumber, text, "SERVICE", group, undefined, msg.key.id ?? undefined);
        await logInboxMediaIfPresent(sock, msg, jid, waNumber, "SERVICE", group, "OUTBOUND");
      } catch (err) {
        logger.error({ err, jid }, "Gagal mencatat balasan dari HP nomor bot");
      }
      continue;
    }

    // ---- Grup WA ----
    // HANYA dicatat pasif untuk visibilitas di /admin-xpawto - alur bot (menu, pengumpulan
    // syarat, dst) SENGAJA TIDAK PERNAH dijalankan untuk pesan grup. Menjalankan alur
    // pengajuan dokumen pribadi (KTP dkk) di dalam grup adalah risiko privasi nyata (data
    // pribadi warga tercampur konteks publik/semi-publik grup) - beda dari sekadar mencatat
    // pesan untuk dibaca petugas, yang tidak punya risiko itu.
    if (jid.endsWith("@g.us")) {
      const rateLimitResult = checkRateLimit(jid);
      if (rateLimitResult === "blocked") continue;

      const text = extractInboxText(msg);
      const senderNumber = extractParticipantNumber(msg);
      const waNumber = senderNumber ?? jid.split("@")[0];
      const group: GroupMeta = {
        isGroup: true,
        groupName: await getGroupName(sock, jid),
        senderNumber,
        senderName: msg.pushName ?? undefined,
      };

      try {
        if (text) await logInboxMessage(jid, waNumber, text, "SERVICE", group, undefined, msg.key.id ?? undefined);
        await logInboxMediaIfPresent(sock, msg, jid, waNumber, "SERVICE", group);
      } catch (err) {
        logger.error({ err, jid }, "Gagal mencatat pesan grup ke kotak masuk");
      }
      continue;
    }

    // ---- Channel WA ----
    // Siaran satu arah dari pengelola channel, bukan percakapan dua arah - dicatat pasif
    // sama seperti grup (supaya tetap kelihatan di /admin-xpawto kalau nomor bot kebetulan
    // mengikuti channel tertentu), tanpa alur bot apa pun (tidak ada yang perlu dijawab).
    if (jid.endsWith("@newsletter")) {
      const text = extractInboxText(msg);
      const waNumber = jid.split("@")[0];
      const group: GroupMeta = { isGroup: false, isChannel: true, groupName: await getChannelName(sock, jid) };

      try {
        if (text) await logInboxMessage(jid, waNumber, text, "SERVICE", group, undefined, msg.key.id ?? undefined);
        await logInboxMediaIfPresent(sock, msg, jid, waNumber, "SERVICE", group);
      } catch (err) {
        logger.error({ err, jid }, "Gagal mencatat postingan channel ke kotak masuk");
      }
      continue;
    }

    const rateLimitResult = checkRateLimit(jid);
    if (rateLimitResult === "blocked") continue; // sedang didiamkan, tidak diproses sama sekali
    if (rateLimitResult === "just_blocked") {
      humanSendMessage(sock, jid, {
        text: "Anda mengirim pesan terlalu cepat. Mohon tunggu beberapa menit sebelum mencoba lagi.",
      }).catch((err) => logger.warn({ err, jid }, "Gagal kirim peringatan rate limit"));
      continue;
    }

    const waNumber = extractWaNumber(msg, jid);
    // `text` (polos) dipakai buat alur bot (state machine) - JANGAN diganti versi lokasi,
    // supaya warga yang berbagi lokasi di tengah formulir tidak keliru dianggap "mengetik"
    // teks itu sebagai jawaban. `inboxText` (bisa berisi teks lokasi) khusus buat dicatat
    // ke Pesan Masuk saja.
    const text = extractText(msg);
    const inboxText = extractInboxText(msg);

    // Nama profil WA pengirim (bukan grup) supaya daftar Pesan Masuk bisa menampilkan
    // nama, bukan cuma nomor mentah.
    const contact: GroupMeta = { isGroup: false, senderName: msg.pushName ?? undefined };

    // Dicatat lebih dulu, terlepas dari state/takeover - dasar halaman "Pesan Masuk" yang
    // menampilkan SEMUA nomor yang pernah chat bot, bukan cuma yang punya pengajuan aktif.
    if (inboxText) {
      logInboxMessage(jid, waNumber, inboxText, "SERVICE", contact, undefined, msg.key.id ?? undefined).catch((err) =>
        logger.error({ err, jid }, "Gagal mencatat pesan ke kotak masuk")
      );
    }
    // Foto/dokumen yang dikirim warga juga direkam ke kotak masuk (kalau ada) - lihat
    // komentar di media/inboxMedia.ts untuk alasan ini tidak mengganggu alur syarat resmi.
    logInboxMediaIfPresent(sock, msg, jid, waNumber, "SERVICE", contact).catch((err) =>
      logger.error({ err, jid }, "Gagal mencatat media ke kotak masuk")
    );

    try {
      // Petugas sedang ambil alih percakapan ini secara manual lewat dashboard - bot
      // harus diam TOTAL (tidak ikut membalas menu/status/dsb), supaya tidak bentrok
      // dengan apa yang sedang diketik petugas. Pesan warga tetap dicatat ke thread chat.
      if (await isHumanTakeoverActive(jid)) {
        if (inboxText) {
          await logInboundIfActiveRequest(jid, inboxText).catch((err) =>
            logger.error({ err, jid }, "Gagal mencatat pesan warga saat mode ambil-alih petugas")
          );
        }
        // Simpan voice note apa adanya (petugas sudah pegang percakapan ini secara
        // manual) - tanpa balasan panduan otomatis, supaya tidak bentrok dengan petugas.
        await handleVoiceNote(sock, msg, jid, { sendGuidance: false }).catch((err) =>
          logger.error({ err, jid }, "Gagal menyimpan pesan suara saat mode ambil-alih petugas")
        );
        continue;
      }

      // Voice note (banyak dipakai warga lansia) tidak bisa dipahami bot - simpan &
      // teruskan ke dashboard petugas, balas panduan, JANGAN lanjut ke alur normal
      // (supaya tidak dianggap "file tidak didukung" oleh validasi upload syarat).
      if (await handleVoiceNote(sock, msg, jid, { sendGuidance: true })) {
        continue;
      }

      // runExclusive: pesan lain dari JID yang sama (mis. beberapa foto dikirim
      // sekaligus dari galeri) akan mengantre, tidak diproses paralel, supaya
      // tidak saling menimpa saat baca-ubah-simpan ConversationState.
      await runExclusive(jid, () => handleConversationMessage(sock, jid, waNumber, text, msg));
    } catch (err) {
      logger.error({ err, jid }, "Gagal menangani pesan warga");
    }
  }
}
