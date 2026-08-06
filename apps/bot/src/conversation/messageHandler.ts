import { extractMessageContent, type WAMessage, type WASocket } from "@whiskeysockets/baileys";
import { logger } from "../logger";
import { handleConversationMessage } from "./handler";
import { runExclusive } from "./mutex";
import { checkRateLimit } from "./rateLimit";
import { humanSendMessage } from "../wa/humanSend";
import { isHumanTakeoverActive } from "./humanTakeover";
import { logInboundIfActiveRequest, logInboxMessage, logOutboundFromDevice, type GroupMeta } from "./messageLog";
import { handleVoiceNote } from "../media/voiceNote";
import { logInboxMediaIfPresent } from "../media/inboxMedia";
import { getGroupName } from "../wa/groupNameCache";
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

export async function handleIncomingMessages(sock: WASocket, payload: MessagesUpsertPayload): Promise<void> {
  if (payload.type !== "notify") return;

  for (const msg of payload.messages) {
    const jid = msg.key.remoteJid;
    if (!jid) continue;
    if (jid === "status@broadcast" || jid.endsWith("@broadcast")) continue;
    if (!msg.message) continue;

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
      const waNumber = jid.split("@")[0];
      const text = extractInboxText(msg);
      const group: GroupMeta | undefined = isGroup
        ? { isGroup: true, groupName: await getGroupName(sock, jid) }
        : undefined;

      try {
        if (text) await logOutboundFromDevice(jid, waNumber, text, "SERVICE", group);
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
        if (text) await logInboxMessage(jid, waNumber, text, "SERVICE", group);
        await logInboxMediaIfPresent(sock, msg, jid, waNumber, "SERVICE", group);
      } catch (err) {
        logger.error({ err, jid }, "Gagal mencatat pesan grup ke kotak masuk");
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
      logInboxMessage(jid, waNumber, inboxText, "SERVICE", contact).catch((err) =>
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
