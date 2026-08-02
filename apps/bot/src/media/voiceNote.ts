import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { downloadMediaMessage, extractMessageContent } from "@whiskeysockets/baileys";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { prisma } from "@kelurahan/db";
import { config } from "../config";
import { logger } from "../logger";
import { encryptBuffer } from "./fileEncryption";
import { humanSendMessage } from "../wa/humanSend";

const GUIDANCE_WITH_REQUEST =
  "Kami menerima pesan suara Anda, namun asisten otomatis ini belum bisa memahami isi rekaman suara.\n\n" +
  "Rekaman ini sudah diteruskan ke petugas kami untuk didengarkan langsung. Kalau bisa, mohon juga ketik " +
  "keperluan Anda lewat teks - atau minta bantuan keluarga untuk mengetikkannya.";

const GUIDANCE_WITHOUT_REQUEST =
  "Kami menerima pesan suara Anda, namun asisten otomatis ini belum bisa memahami isi rekaman suara.\n\n" +
  "Mohon ketik pesan teks - ketik *menu* untuk melihat pilihan layanan, atau minta bantuan keluarga untuk mengetikkan keperluan Anda.";

export function hasVoiceNote(msg: WAMessage): boolean {
  const m = extractMessageContent(msg.message ?? undefined) ?? msg.message;
  return Boolean(m?.audioMessage);
}

/**
 * Warga (banyak di antaranya orang tua) sering membalas dengan voice note yang bot tidak
 * bisa pahami isinya. Daripada dibiarkan tidak direspons atau kena pesan generik "tidak
 * dikenali", rekamannya disimpan (terenkripsi, sama seperti berkas syarat) dan diteruskan
 * ke thread chat dashboard supaya petugas bisa mendengarkan langsung dan menindaklanjuti
 * manual - tidak butuh speech-to-text yang mahal/berat untuk memberi nilai nyata di sini.
 * Kembalikan true kalau ini memang voice note (supaya pemanggil tahu harus berhenti di sini,
 * tidak lanjut ke pemrosesan pesan normal).
 */
export async function handleVoiceNote(
  sock: WASocket,
  msg: WAMessage,
  waJid: string,
  options: { sendGuidance: boolean }
): Promise<boolean> {
  if (!hasVoiceNote(msg)) return false;

  const active = await prisma.request.findFirst({
    where: { waJid, status: { in: ["DICEK", "DIPROSES"] } },
    orderBy: { createdAt: "desc" },
  });

  if (!active) {
    if (options.sendGuidance) {
      await humanSendMessage(sock, waJid, { text: GUIDANCE_WITHOUT_REQUEST });
    }
    return true;
  }

  try {
    const buffer = (await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { logger: logger.child({ module: "media" }) as any, reuploadRequest: sock.updateMediaMessage }
    )) as Buffer;

    const destDir = path.join(config.uploadDir, active.id);
    await fs.promises.mkdir(destDir, { recursive: true });
    const fileName = `voicenote-${randomUUID()}.ogg`;
    await fs.promises.writeFile(path.join(destDir, fileName), encryptBuffer(buffer));

    await prisma.requestMessage.create({
      data: {
        requestId: active.id,
        direction: "INBOUND",
        message: "[Pesan suara]",
        attachmentPath: path.join(active.id, fileName),
        attachmentMimeType: "audio/ogg",
      },
    });
  } catch (err) {
    logger.warn({ err, waJid }, "Gagal menyimpan pesan suara warga");
  }

  if (options.sendGuidance) {
    await humanSendMessage(sock, waJid, { text: GUIDANCE_WITH_REQUEST });
  }
  return true;
}
