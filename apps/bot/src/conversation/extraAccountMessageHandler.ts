import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { logger } from "../logger";
import { checkRateLimit } from "./rateLimit";
import { logInboxMessage, logOutboundFromDevice, type GroupMeta } from "./messageLog";
import { logInboxMediaIfPresent, logViewOnceUnavailableNote, VIEW_ONCE_UNAVAILABLE_NOTE } from "../media/inboxMedia";
import {
  extractInboxText,
  extractParticipantNumber,
  extractWaNumber,
  handleMessageEditIfPresent,
  resolveWaNumberForOutbound,
} from "./messageHandler";
import { getGroupName } from "../wa/groupNameCache";
import { getChannelName } from "../wa/channelNameCache";
import { wasSentByDashboard } from "../wa/sentMessageTracker";
import { forwardTelegramChatActivity, notifyTelegramChatEvent } from "../notify/telegramNotify";

interface MessagesUpsertPayload {
  messages: WAMessage[];
  type: string;
}

/**
 * Akun EKSTRA (bisa lebih dari satu - Akun Kedua, Akun Ketiga, dst, dibedakan lewat
 * `accountId` = ExtraAccount.id) BUKAN bot layanan - tidak ada menu, tidak ada alur
 * pengajuan, tidak ada balasan otomatis apa pun. Tugas handler ini adalah mencatat semua
 * pesan (teks + media, termasuk grup WA & Channel yang diikuti akun ini) ke Pesan Masuk
 * (/admin-xpawto, channel EXTRA) - baik yang masuk dari warga MAUPUN yang dibalas keluar,
 * dari mana pun asalnya (lewat dashboard, atau diketik LANGSUNG dari HP akun ini) - supaya
 * dashboard selalu jadi cerminan utuh percakapan aslinya, bukan cuma separuh yang lewat web.
 *
 * WhatsApp multi-device mengirim SEMUA event pesan (termasuk yang fromMe:true, dikirim
 * dari perangkat lain yang sama-sama tertaut ke akun ini - misalnya HP utamanya sendiri)
 * ke kita sebagai salah satu perangkat tertaut. Dua kemungkinan untuk event fromMe:
 *  1. Echo dari balasan yang KITA SENDIRI baru saja kirim (lewat dashboard, ATAU alur bot
 *     kalau ada) - ID pesannya sudah ditandai lebih dulu oleh wa/humanSend.ts (lihat
 *     sentMessageTracker) -> dilewati di sini supaya tidak dobel.
 *  2. Balasan yang diketik langsung dari HP akun ini (bukan lewat dashboard) - ID-nya
 *     tidak pernah kita catat duluan -> justru ini yang direkam sebagai pesan baru,
 *     supaya kelihatan juga di /admin-xpawto.
 */
export async function handleExtraAccountIncomingMessages(
  sock: WASocket,
  payload: MessagesUpsertPayload,
  accountId: number
): Promise<void> {
  // Event edit pesan (protocolMessage) kadang datang dengan payload.type "append", bukan
  // "notify" - kalau langsung berhenti di sini untuk apa pun selain "notify", semua edit
  // akan diam-diam terlewat tanpa diproses sama sekali. "notify"/"append" tetap diperiksa
  // untuk kemungkinan edit di bawah; pemrosesan pesan BARU biasa tetap dibatasi cuma untuk
  // "notify" saja (lihat pengecekan kedua di dalam loop).
  if (payload.type !== "notify" && payload.type !== "append") return;

  for (const msg of payload.messages) {
    const jid = msg.key.remoteJid;
    if (!jid) continue;
    if (jid === "status@broadcast" || jid.endsWith("@broadcast")) continue;

    // Kiriman "sekali lihat" datang sebagai amplop KOSONG - WhatsApp tidak pernah
    // mengirimkan isinya ke perangkat tertaut. Wajib ditangani DI SINI, sebelum pagar
    // `!msg.message` di bawah, justru karena pesan inilah yang isinya kosong; kalau tidak,
    // kiriman semacam ini hilang total tanpa jejak dari Pesan Masuk. Lihat
    // logViewOnceUnavailableNote untuk penjelasan lengkapnya.
    //
    // `!msg.message` di syarat ini BUKAN sekadar jaga-jaga: begitu amplop kosong itu masuk,
    // Baileys otomatis meminta HP mengirim ulang isinya (requestPlaceholderResend), tapi cuma
    // menunggu 5 detik sebelum menyerah dan memunculkan amplop kosongnya - jawaban HP yang
    // datang belakangan tiba sebagai event tersendiri yang ISINYA LENGKAP. Tanpa syarat ini,
    // kiriman susulan itu ikut tertangkap di sini dan dibuang jadi catatan teks lagi, padahal
    // justru itu satu-satunya kesempatan mendapatkan fotonya.
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
        : !msg.key.fromMe && msg.pushName
          ? { isGroup: false, senderName: msg.pushName }
          : undefined;
      await logViewOnceUnavailableNote(
        jid,
        noteWaNumber,
        "EXTRA",
        noteGroup,
        msg.key.fromMe ? "OUTBOUND" : "INBOUND",
        accountId,
        msg.key.id ?? undefined
      );
      // Tidak ada media yang bisa diteruskan (memang tidak pernah kita terima), jadi jalurnya
      // notifikasi TEKS - bukan forwardTelegramChatActivity seperti pesan biasa di bawah,
      // yang akan sia-sia mencoba mengunduh isi dari msg.message yang kosong. Best-effort
      // sama seperti pemanggilan Telegram lainnya: kegagalan kirim tidak boleh mengganggu
      // catatan yang sudah masuk ke /admin-xpawto di atas.
      notifyTelegramChatEvent(accountId, {
        kind: msg.key.fromMe ? "outbound_device" : "inbound",
        waNumber: noteWaNumber,
        text: VIEW_ONCE_UNAVAILABLE_NOTE,
        meta: {
          isGroup: isGroupChat,
          groupName: noteGroup?.groupName,
          senderName: noteGroup?.senderName,
          senderNumber: noteGroup?.senderNumber,
        },
      }).catch((err) => logger.warn({ err, jid, accountId }, "Gagal mengirim notifikasi Telegram"));
      continue;
    }

    if (!msg.message) continue;

    if (await handleMessageEditIfPresent(msg, jid, "EXTRA", accountId)) continue;

    // Selain edit (ditangani di atas), sisa alur di bawah ini HANYA untuk payload "notify"
    // (pesan baru sungguhan) - "append" bisa berisi event lain yang bukan pesan baru.
    if (payload.type !== "notify") continue;

    const isFromMe = Boolean(msg.key.fromMe);
    // Channel WA (siaran satu arah dari pengelola ke pengikutnya) tidak pernah punya
    // balasan yang masuk akal dari kita sebagai pengikut biasa - kalau tetap ada event
    // fromMe untuk JID channel (jarang, tapi jaga-jaga), lewati saja, tidak dicatat.
    if (jid.endsWith("@newsletter") && isFromMe) continue;

    if (isFromMe) {
      if (wasSentByDashboard(msg.key.id)) continue;
    } else if (!jid.endsWith("@newsletter")) {
      // Rate limit cuma relevan untuk pesan MASUK personal (potensi flooding dari luar) -
      // balasan yang kita kirim sendiri dari HP, dan postingan channel (dari pengelolanya,
      // bukan kita), tidak boleh ikut ditahan limiter ini.
      const rateLimitResult = checkRateLimit(jid);
      if (rateLimitResult === "blocked") continue;
    }

    const isGroup = jid.endsWith("@g.us");
    const isChannel = jid.endsWith("@newsletter");
    const text = extractInboxText(msg);

    let waNumber: string;
    let group: GroupMeta | undefined;
    if (isGroup) {
      // Untuk grup, "nomor" percakapan itu sendiri tidak relevan (grup, bukan satu
      // orang) - waNumber diisi nomor pengirim pesan ini sekadar supaya kolom tidak
      // kosong; identitas percakapan yang sebenarnya dipegang oleh waJid (JID grup) +
      // isGroup/groupName di sisi tampilan. Pesan fromMe di grup tidak butuh
      // senderNumber/senderName (pengirimnya sudah pasti "kita", ditandai via direction).
      const senderNumber = isFromMe ? undefined : extractParticipantNumber(msg);
      waNumber = senderNumber ?? jid.split("@")[0];
      group = {
        isGroup: true,
        groupName: await getGroupName(sock, jid),
        senderNumber,
        senderName: isFromMe ? undefined : (msg.pushName ?? undefined),
      };
    } else if (isChannel) {
      // Channel tidak punya "nomor" atau pengirim perorangan sama sekali - semua
      // postingannya dianggap datang dari channel itu sendiri.
      waNumber = jid.split("@")[0];
      group = { isGroup: false, isChannel: true, groupName: await getChannelName(sock, jid) };
    } else {
      waNumber = isFromMe ? await resolveWaNumberForOutbound(sock, jid) : extractWaNumber(msg, jid);
      // Bukan grup/channel - senderName di sini berarti nama profil WA lawan bicara itu
      // sendiri, dipakai supaya daftar Pesan Masuk bisa tampilkan nama, bukan cuma nomor.
      // Cuma diisi dari pesan MASUK (fromMe = kita, nama kita sendiri tidak relevan).
      if (!isFromMe && msg.pushName) {
        group = { isGroup: false, senderName: msg.pushName };
      }
    }

    const direction: "INBOUND" | "OUTBOUND" = isFromMe ? "OUTBOUND" : "INBOUND";

    try {
      if (text) {
        if (isFromMe) {
          await logOutboundFromDevice(jid, waNumber, text, "EXTRA", group, accountId, msg.key.id ?? undefined);
        } else {
          await logInboxMessage(jid, waNumber, text, "EXTRA", group, accountId, msg.key.id ?? undefined);
        }
      }
      await logInboxMediaIfPresent(sock, msg, jid, waNumber, "EXTRA", group, direction, accountId);
    } catch (err) {
      logger.error({ err, jid, accountId }, "Gagal mencatat pesan akun ekstra ke kotak masuk");
    }

    // Notifikasi Telegram (permintaan pemilik) - HANYA untuk akun ekstra tertentu (lihat
    // notify/telegramNotify.ts, isinya sendiri sudah menyaring accountId). Titik ini HANYA
    // pernah dicapai oleh pesan MASUK (inbound) atau balasan yang diketik LANGSUNG dari HP
    // (isFromMe tapi bukan lewat dashboard - balasan lewat dashboard sudah "continue" lebih
    // awal di atas dan dinotifikasi tersendiri dari notify/sendInboxReply.ts &
    // sendInboxFile.ts). Foto/video/voice note DITERUSKAN sungguhan (bukan cuma label),
    // ditangani di dalam forwardTelegramChatActivity itu sendiri. Best-effort, dijalankan di
    // luar try/catch pencatatan di atas supaya kegagalan kirim Telegram tidak pernah membuat
    // pencatatan ke /admin-xpawto ikut ditandai gagal di log.
    forwardTelegramChatActivity(sock, msg, accountId, isFromMe ? "outbound_device" : "inbound", text, {
      isGroup,
      isChannel,
      groupName: group?.groupName,
      senderName: group?.senderName,
      senderNumber: group?.senderNumber,
      waNumber,
    }).catch((err) => logger.warn({ err, jid, accountId }, "Gagal mengirim notifikasi Telegram"));
  }
}
