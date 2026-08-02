import fs from "fs";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { logger } from "../logger";
import { downloadAndValidate, hasSupportedMedia, MediaRejectedError } from "../media/download";
import { finalizeRequest } from "../media/finalize";
import { notifyStaffNewRequest } from "../notify/notifyStaff";
import { mainMenuText, resolveServiceChoice, serviceLabel } from "./menu";
import { MESSAGES, startCollectingText } from "./messages";
import { loadRequirementsSnapshot, nextPendingRequirement, requirementsListText } from "./requirements";
import { extractKtpData } from "../media/ocr";
import { watermarkDocumentImage } from "../media/watermark";
import { logInboundIfActiveRequest } from "./messageLog";
import { expirePendingRating, findPendingRating, submitRating } from "./rating";
import { selfCancelRequest } from "./selfCancel";
import { buildStatusReport } from "./statusReport";
import { loadConversation, resetConversation, saveConversation } from "./store";
import type { ConversationContext, UploadedDocDraft } from "./types";
import { isWithinWorkingHours, WORKING_HOURS_NOTE } from "./workingHours";
import { humanSendMessage } from "../wa/humanSend";

async function cleanupTempFiles(docs: UploadedDocDraft[]): Promise<void> {
  await Promise.all(
    docs.map((doc) => fs.promises.unlink(doc.tempFilePath).catch(() => undefined))
  );
}

async function reply(sock: WASocket, waJid: string, text: string): Promise<void> {
  await humanSendMessage(sock, waJid, { text });
}

export async function handleConversationMessage(
  sock: WASocket,
  waJid: string,
  waNumber: string,
  text: string | undefined,
  msg: WAMessage
): Promise<void> {
  const normalized = text?.trim().toLowerCase();

  // "batal <nomor tiket>" (mis. "batal KK-2608-0004") membatalkan pengajuan yang
  // SUDAH terkirim (selama masih DICEK) - beda dari "batal" polos di bawah yang
  // membatalkan proses upload yang sedang berjalan. Dicek lebih dulu supaya tidak
  // ketabrak match "batal" biasa.
  const cancelTicketMatch = text?.trim().match(/^batal\s+(\S+)$/i);
  if (cancelTicketMatch) {
    await reply(sock, waJid, await selfCancelRequest(waJid, cancelTicketMatch[1]));
    return;
  }

  if (normalized === "batal") {
    const conv = await loadConversation(waJid);
    await cleanupTempFiles(conv.context.uploadedDocs);
    await resetConversation(waJid);
    await reply(sock, waJid, MESSAGES.cancelled);
    return;
  }

  if (normalized === "menu") {
    const conv = await loadConversation(waJid);
    await cleanupTempFiles(conv.context.uploadedDocs);
    await resetConversation(waJid);
    // Warga sudah "pindah topik" secara eksplisit - jangan lagi anggap balasan angka
    // berikutnya sebagai rating pengajuan lama yang mungkin masih dalam jendela waktu.
    await expirePendingRating(waJid).catch(() => undefined);
    await reply(sock, waJid, mainMenuText());
    return;
  }

  if (normalized === "status" || normalized === "cek status") {
    // Sengaja tidak menyentuh ConversationState - warga bisa cek status kapan saja
    // tanpa mengganggu proses upload syarat yang mungkin sedang berjalan.
    await reply(sock, waJid, await buildStatusReport(waJid));
    return;
  }

  const conv = await loadConversation(waJid);

  if (conv.step === "IDLE") {
    // Balasan angka polos 1-5 setelah pengajuan SELESAI dianggap rating kepuasan,
    // BUKAN pilihan menu - meski "1"/"2"/"3" juga kebetulan kode layanan, ini sengaja
    // diprioritaskan karena warga baru saja diminta menilai. Begitu warga ketik *menu*
    // lagi, jendela rating ini otomatis kedaluwarsa (lihat handler "menu" di atas).
    if (normalized && /^[1-5]$/.test(normalized)) {
      const pendingRating = await findPendingRating(waJid);
      if (pendingRating) {
        await submitRating(pendingRating.id, Number(normalized));
        await reply(sock, waJid, MESSAGES.ratingThanks(Number(normalized)));
        return;
      }
    }

    const choice = text ? resolveServiceChoice(text) : undefined;
    if (!choice) {
      // Warga chat bebas di luar alur (mis. tanya progres) - catat sebagai konteks
      // percakapan kalau ada pengajuan aktif, supaya kelihatan di dashboard petugas.
      if (text) {
        await logInboundIfActiveRequest(waJid, text).catch((err) =>
          logger.error({ err }, "Gagal mencatat pesan masuk warga")
        );
      }
      await reply(sock, waJid, mainMenuText());
      return;
    }
    conv.step = "AWAIT_NAME";
    conv.context = { serviceType: choice.serviceType, uploadedDocs: [] };
    await saveConversation(conv);
    await reply(sock, waJid, MESSAGES.askName);
    return;
  }

  if (conv.step === "AWAIT_NAME") {
    const name = text?.trim();
    if (!name || name.length < 3) {
      await reply(sock, waJid, MESSAGES.invalidName);
      return;
    }
    const snapshot = await loadRequirementsSnapshot(conv.context.serviceType!);
    if (snapshot.length === 0) {
      await resetConversation(waJid);
      await reply(sock, waJid, MESSAGES.noRequirementsConfigured);
      return;
    }
    conv.context.applicantName = name;
    conv.requirementsSnapshot = snapshot;
    conv.step = "COLLECTING_DOCS";
    await saveConversation(conv);
    await reply(sock, waJid, startCollectingText(requirementsListText(snapshot), snapshot[0].name));
    return;
  }

  if (conv.step === "COLLECTING_DOCS") {
    const uploadedIds = conv.context.uploadedDocs.map((d) => d.requirementId);
    const pending = nextPendingRequirement(conv.requirementsSnapshot, uploadedIds);

    if (!pending) {
      // Sudah lengkap tapi entah kenapa belum difinalisasi - jaga-jaga, jangan macet.
      await finalizeAndReply(sock, waJid, waNumber, conv);
      return;
    }

    if (!hasSupportedMedia(msg)) {
      await reply(sock, waJid, MESSAGES.waitingForDocInsteadOfText(pending.name));
      return;
    }

    try {
      const downloaded = await downloadAndValidate(sock, msg, waJid);
      let ocrNik: string | undefined;
      let ocrRawText: string | undefined;
      if (downloaded.mimeType.startsWith("image/")) {
        if (pending.ocrKtp) {
          // OCR dulu di atas foto asli (belum ada watermark) supaya akurasi baca NIK tidak
          // terganggu, baru watermark ditumpuk sebelum file ini disimpan permanen.
          const ocrResult = await extractKtpData(downloaded.tempFilePath);
          ocrNik = ocrResult?.nik;
          ocrRawText = ocrResult?.rawText;
        }

        // Watermark diterapkan ke SEMUA syarat berupa gambar (bukan cuma yang ocrKtp) -
        // KK, buku nikah, dsb sama-sama memuat data pribadi yang berisiko kalau bocor.
        const original = await fs.promises.readFile(downloaded.tempFilePath);
        const watermarked = await watermarkDocumentImage(
          original,
          conv.context.serviceType ? serviceLabel(conv.context.serviceType) : "PENGAJUAN"
        );
        await fs.promises.writeFile(downloaded.tempFilePath, watermarked);
      }
      conv.context.uploadedDocs.push({
        requirementId: pending.id,
        requirementName: pending.name,
        tempFilePath: downloaded.tempFilePath,
        fileName: downloaded.fileName,
        mimeType: downloaded.mimeType,
        ocrNik,
        ocrRawText,
      });
      await saveConversation(conv);

      const stillPending = nextPendingRequirement(
        conv.requirementsSnapshot,
        conv.context.uploadedDocs.map((d) => d.requirementId)
      );

      if (!stillPending) {
        await finalizeAndReply(sock, waJid, waNumber, conv);
      } else {
        await reply(
          sock,
          waJid,
          MESSAGES.progress(conv.context.uploadedDocs.length, conv.requirementsSnapshot.length, stillPending.name)
        );
      }
    } catch (err) {
      if (err instanceof MediaRejectedError) {
        await reply(sock, waJid, err.message);
      } else {
        logger.error({ err }, "Gagal memproses dokumen syarat");
        await reply(sock, waJid, "Terjadi kesalahan saat memproses file. Mohon kirim ulang.");
      }
    }
    return;
  }

  await reply(sock, waJid, MESSAGES.unrecognized);
}

async function finalizeAndReply(
  sock: WASocket,
  waJid: string,
  waNumber: string,
  conv: { context: ConversationContext; requirementsSnapshot: { id: number; name: string; order: number }[] }
): Promise<void> {
  const result = await finalizeRequest(
    waJid,
    waNumber,
    conv.context.serviceType!,
    conv.context.applicantName!,
    conv.context
  );
  const outsideHoursNote = isWithinWorkingHours() ? "" : WORKING_HOURS_NOTE;
  await reply(sock, waJid, MESSAGES.submitted(result.ticketNumber, result.trackingToken) + outsideHoursNote);

  await notifyStaffNewRequest(sock, {
    ticketNumber: result.ticketNumber,
    serviceType: conv.context.serviceType!,
    applicantName: conv.context.applicantName!,
    waNumber,
  }).catch((err) => logger.error({ err }, "Gagal mengirim notifikasi pengajuan baru ke petugas"));
}
