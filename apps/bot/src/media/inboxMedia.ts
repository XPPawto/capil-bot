import fs from "fs";
import path from "path";
import crypto, { randomUUID } from "crypto";
import { downloadMediaMessage, extractMessageContent } from "@whiskeysockets/baileys";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { prisma, appendLedgerEntry, type InboxChannel, type InboxMessage } from "@kelurahan/db";
import { config } from "../config";
import { logger } from "../logger";
import { encryptBuffer } from "./fileEncryption";
import { detectRealMimeType } from "./fileSignature";
import type { GroupMeta } from "../conversation/messageLog";

/** Sama seperti createLedgeredInboxMessage di conversation/messageLog.ts - dipisah di sini
 * supaya media/inboxMedia.ts tidak perlu impor balik dari conversation/, tapi tetap menjamin
 * ATURAN yang sama: tidak ada baris InboxMessage yang lolos tanpa jejak ledger. */
async function createLedgeredInboxMessage(
  data: Parameters<typeof prisma.inboxMessage.create>[0]["data"],
  attachmentSha256: string | null
): Promise<InboxMessage> {
  const row = await prisma.inboxMessage.create({ data });
  try {
    await appendLedgerEntry("MESSAGE_CREATED", row.id, {
      waJid: row.waJid,
      waNumber: row.waNumber,
      channel: row.channel,
      extraAccountId: row.extraAccountId,
      direction: row.direction,
      message: row.message,
      attachmentPath: row.attachmentPath,
      attachmentMimeType: row.attachmentMimeType,
      attachmentSha256,
      isGroup: row.isGroup,
      isChannel: row.isChannel,
      groupName: row.groupName,
      senderNumber: row.senderNumber,
      senderName: row.senderName,
      adminId: row.adminId,
      waMessageId: row.waMessageId,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err, inboxMessageId: row.id }, "GAGAL menulis jejak audit ledger untuk media yang baru dicatat");
  }
  return row;
}

/**
 * Foto/video "sekali lihat" TIDAK PERNAH dikirim WhatsApp ke perangkat tertaut (linked
 * device) seperti bot ini - ini pembatasan di sisi WhatsApp sendiri, bukan bug di kode kita
 * dan bukan sesuatu yang bisa diakali dari sini. Yang datang cuma amplop pesannya: stanza-nya
 * berisi anak `<unavailable type="view_once"/>` SEBAGAI PENGGANTI `<enc>`, jadi tidak ada
 * ciphertext apa pun untuk didekripsi. Baileys menandainya dengan `msg.key.isViewOnce = true`
 * lalu menyetel messageStubType = CIPHERTEXT dengan `message` KOSONG (lihat
 * Utils/decode-wa-message.js). Akibatnya pesan semacam ini berhenti jauh sebelum
 * logInboxMediaIfPresent - kena pagar `if (!msg.message) continue` di handler - sehingga
 * dulu hilang total dari Pesan Masuk tanpa jejak apa pun.
 *
 * Karena isinya memang tidak ada, yang bisa dilakukan cuma mencatat KEJADIANNYA: petugas
 * jadi tahu ada kiriman sekali-lihat pada jam sekian dari siapa, dan bisa membukanya
 * langsung di HP akun bersangkutan (satu-satunya tempat isinya benar-benar ada).
 */
/** Dipakai bersama oleh catatan Pesan Masuk dan notifikasi Telegram - satu sumber supaya
 * teksnya tidak pernah beda antara keduanya. Tipe medianya (foto atau video) sengaja tidak
 * disebut: amplop yang datang memang tidak membawa informasi itu sama sekali. */
export const VIEW_ONCE_UNAVAILABLE_NOTE = "[Kiriman sekali lihat - hanya bisa dibuka langsung di HP]";

export async function logViewOnceUnavailableNote(
  waJid: string,
  waNumber: string,
  channel: InboxChannel,
  group?: GroupMeta,
  direction: "INBOUND" | "OUTBOUND" = "INBOUND",
  extraAccountId?: number,
  waMessageId?: string
): Promise<void> {
  try {
    await createLedgeredInboxMessage(
      {
        waJid,
        waNumber,
        channel,
        extraAccountId,
        direction,
        waMessageId,
        message: VIEW_ONCE_UNAVAILABLE_NOTE,
        isGroup: group?.isGroup ?? false,
        isChannel: group?.isChannel ?? false,
        groupName: group?.groupName,
        senderNumber: group?.senderNumber,
        senderName: group?.senderName,
      },
      null
    );
  } catch (err) {
    logger.warn({ err, waJid }, "Gagal mencatat catatan kiriman sekali lihat");
  }
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

const EXT_BY_VIDEO_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
};

/**
 * Foto/dokumen yang dikirim warga direkam apa adanya ke Pesan Masuk (/admin-xpawto),
 * terlepas dari state percakapan yang sedang berjalan - mis. foto iseng, foto KTP yang
 * dikirim sebelum masuk alur formulir resmi, atau lampiran lain di luar konteks pengajuan.
 * Ini TIDAK menggantikan alur resmi pengumpulan syarat (COLLECTING_DOCS di handler.ts) -
 * berkas syarat yang dikirim selagi mengisi formulir tetap JUGA tersimpan lewat jalur itu
 * seperti biasa (RequestDocument); di sini cuma salinan generik demi visibilitas
 * percakapan bagi petugas, disimpan terenkripsi sama seperti berkas syarat lainnya.
 */
export async function logInboxMediaIfPresent(
  sock: WASocket,
  msg: WAMessage,
  waJid: string,
  waNumber: string,
  channel: InboxChannel = "SERVICE",
  group?: GroupMeta,
  direction: "INBOUND" | "OUTBOUND" = "INBOUND",
  extraAccountId?: number
): Promise<void> {
  const raw = msg.message;
  const m = extractMessageContent(raw ?? undefined) ?? raw;
  if (!m) return;
  const isImage = Boolean(m.imageMessage);
  const isDocument = Boolean(m.documentMessage);
  const isVideo = Boolean(m.videoMessage);
  const isSticker = Boolean(m.stickerMessage);
  // "Video note" (video bulat pendek yang direkam langsung dari tombol kamera) BUKAN
  // videoMessage biasa - WhatsApp mengirimnya sebagai tipe pesan tersendiri, `ptvMessage`
  // (isinya struktur IVideoMessage yang sama). Karena dulu tidak ikut dikenali di sini,
  // kiriman semacam ini berhenti di pagar `return` di bawah dan hilang total dari Pesan
  // Masuk. Unduhannya sendiri tidak butuh perlakuan khusus: Baileys memetakan mediaType
  // "ptv" ke kunci HKDF "Video" yang sama (lihat Defaults/index.js MEDIA_HKDF_KEY_MAPPING).
  const isPtv = Boolean(m.ptvMessage);
  // Audio cuma ditangani di sini untuk channel EXTRA (akun ekstra tidak punya alur
  // syarat/Request sama sekali). Untuk SERVICE, voice note sudah punya jalur khusus sendiri
  // (media/voiceNote.ts, tersimpan ke RequestMessage) - kalau ikut ditangani di sini juga,
  // hasilnya jadi dobel tampil di thread gabungan /admin-xpawto untuk warga yang sedang
  // punya pengajuan aktif.
  const isAudio = Boolean(m.audioMessage) && channel === "EXTRA";
  if (!isImage && !isDocument && !isAudio && !isVideo && !isSticker && !isPtv) return;

  // Foto/video "sekali lihat" diunduh dan disimpan seperti media biasa, supaya petugas bisa
  // melihat ISINYA di Pesan Masuk - bukan cuma label teks "ada kiriman sekali lihat" yang
  // praktis tidak berguna untuk menindaklanjuti pengaduan/pengajuan. Batasan "sekali lihat"
  // cuma ditegakkan di aplikasi WhatsApp resmi, bukan di protokolnya, jadi Baileys memang
  // bisa mengunduhnya. Konsekuensinya disadari: pengirim mengira kontennya hilang setelah
  // dibuka sekali, padahal di sini tersimpan permanen (terenkripsi, sama seperti lampiran
  // lain). Karena itu labelnya SENGAJA tetap menandai asal-usulnya sebagai "sekali lihat",
  // supaya petugas tahu kiriman ini dimaksudkan sensitif oleh pengirimnya dan
  // memperlakukannya sesuai itu.
  //
  // WA menandai "sekali lihat" dengan DUA cara berbeda tergantung versi klien pengirim:
  // (a) flag viewOnce=true langsung di imageMessage/videoMessage-nya sendiri (unwrap-nya
  // sudah dibuka extractMessageContent di atas), ATAU (b) dibungkus wrapper khusus
  // (viewOnceMessage/viewOnceMessageV2/viewOnceMessageV2Extension) yang statusnya cuma
  // kelihatan di objek MENTAH sebelum dibuka bungkusnya - makanya dicek dari `raw`, bukan
  // `m`. Keduanya wajib dicek supaya semua varian dapat label yang benar (downloadMediaMessage
  // sendiri sudah membuka bungkusnya lewat extractMessageContent, jadi unduhannya tidak
  // butuh perlakuan khusus).
  const isViewOnceWrapper = Boolean(raw?.viewOnceMessage || raw?.viewOnceMessageV2 || raw?.viewOnceMessageV2Extension);
  const isViewOnceFlag = Boolean((isImage && m.imageMessage?.viewOnce) || (isVideo && m.videoMessage?.viewOnce));
  const isViewOnce = (isImage || isVideo) && (isViewOnceWrapper || isViewOnceFlag);

  /** Kiriman "sekali lihat" tidak bisa diminta ulang ke pengirim (di HP-nya sudah hangus
   * begitu dibuka), jadi kalau unduhan atau deteksi tipenya gagal, jangan sampai jejaknya
   * hilang total dari thread seperti media biasa - catat minimal sebagai teks supaya petugas
   * tahu ada kiriman yang lolos dan bisa menanyakannya lagi ke warga. */
  const logViewOnceFallback = async (): Promise<void> => {
    if (!isViewOnce) return;
    try {
      await createLedgeredInboxMessage(
        {
          waJid,
          waNumber,
          channel,
          extraAccountId,
          direction,
          message: isImage ? "[Foto sekali lihat - gagal disimpan]" : "[Video sekali lihat - gagal disimpan]",
          isGroup: group?.isGroup ?? false,
          isChannel: group?.isChannel ?? false,
          groupName: group?.groupName,
          senderNumber: group?.senderNumber,
          senderName: group?.senderName,
        },
        null
      );
    } catch (err) {
      logger.warn({ err, waJid }, "Gagal mencatat catatan foto/video sekali lihat");
    }
  };

  try {
    const buffer = (await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { logger: logger.child({ module: "media" }) as any, reuploadRequest: sock.updateMediaMessage }
    )) as Buffer;

    let realMimeType: string | null;
    let ext: string;
    let label: string;
    if (isAudio) {
      // Sama seperti voiceNote.ts: audio tidak divalidasi lewat signature (bukan tipe
      // syarat yang divalidasi ketat), cukup asumsikan ogg (format default WhatsApp).
      realMimeType = "audio/ogg";
      ext = "ogg";
      label = "[Pesan suara]";
    } else if (isVideo || isPtv) {
      // Sama seperti audio: video bukan tipe syarat yang divalidasi ketat (detectRealMimeType
      // cuma kenal JPEG/PNG/PDF) - dipercaya dari mimetype yang diklaim WhatsApp saja, ini
      // cuma untuk visibilitas percakapan di Pesan Masuk, bukan gerbang keamanan.
      realMimeType = (isPtv ? m.ptvMessage?.mimetype : m.videoMessage?.mimetype) ?? "video/mp4";
      ext = EXT_BY_VIDEO_MIME[realMimeType] ?? "mp4";
      // Video note dibedakan lewat label supaya UI bisa merendernya bulat seperti di
      // WhatsApp - berkasnya sendiri mp4 persegi biasa, tidak ada bedanya dari video lain.
      label = isPtv ? "[Video note]" : isViewOnce ? "[Video sekali lihat]" : "[Video]";
    } else if (isSticker) {
      // Stiker WA selalu webp (statis maupun animasi) - "image/webp" supaya UI merender-nya
      // sebagai <img> apa adanya, sama seperti foto biasa (tidak perlu komponen khusus).
      realMimeType = "image/webp";
      ext = "webp";
      label = "[Stiker]";
    } else {
      // Best-effort: kalau isi filenya bukan salah satu dari 3 tipe yang dikenali sistem
      // ini, lewati saja tanpa error - ini cuma catatan tambahan untuk visibilitas, bukan
      // gerbang validasi seperti pada alur upload syarat resmi.
      realMimeType = detectRealMimeType(buffer);
      if (!realMimeType) {
        await logViewOnceFallback();
        return;
      }
      ext = EXT_BY_MIME[realMimeType] ?? "bin";
      label = isImage ? (isViewOnce ? "[Foto sekali lihat]" : "[Foto]") : "[Dokumen]";
    }

    const safeJid = waJid.replace(/[^a-zA-Z0-9._@-]/g, "_");
    const destDir = path.join(config.uploadDir, "_inbox", safeJid);
    await fs.promises.mkdir(destDir, { recursive: true });
    const fileName = `${randomUUID()}.${ext}`;
    await fs.promises.writeFile(path.join(destDir, fileName), encryptBuffer(buffer));

    // Sidik jari (SHA-256) isi ASLI berkas (sebelum dienkripsi) - direkam ke ledger supaya
    // verifikasi nanti bisa mendeteksi kalau berkas di disk pernah ditukar/diubah (dekripsi
    // ulang lalu bandingkan hash-nya, lihat verify-ledger di sisi web).
    const attachmentSha256 = crypto.createHash("sha256").update(buffer).digest("hex");

    await createLedgeredInboxMessage(
      {
        waJid,
        waNumber,
        channel,
        extraAccountId,
        direction,
        message: label,
        attachmentPath: path.join("_inbox", safeJid, fileName),
        attachmentMimeType: realMimeType,
        isGroup: group?.isGroup ?? false,
        isChannel: group?.isChannel ?? false,
        groupName: group?.groupName,
        senderNumber: group?.senderNumber,
        senderName: group?.senderName,
      },
      attachmentSha256
    );
  } catch (err) {
    logger.warn({ err, waJid }, "Gagal menyimpan media warga ke kotak masuk");
    await logViewOnceFallback();
  }
}
