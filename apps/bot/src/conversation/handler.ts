import fs from "fs";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import type { ServiceType } from "@kelurahan/db";
import { logger } from "../logger";
import { hasSupportedMedia, MediaRejectedError } from "../media/download";
import { finalizeRequest } from "../media/finalize";
import { notifyStaffNewRequest } from "../notify/notifyStaff";
import { kkSubmenuText, mainMenuText, resolveKkSubmenuChoice, resolveServiceChoice, serviceLabel } from "./menu";
import { MESSAGES, reviewCompleteText, serviceSelectedText, startCollectingText } from "./messages";
import {
  loadRequirementsSnapshot,
  nextPendingRequirement,
  requirementsListText,
  requirementsStatusListText,
} from "./requirements";
import { intakeDocument } from "./documentIntake";
import { logInboundIfActiveRequest } from "./messageLog";
import { fixIntroText, loadFixRejectedContext } from "./fixRejected";
import { expirePendingRating, findPendingRating, submitRating } from "./rating";
import { selfCancelRequest } from "./selfCancel";
import { buildStatusReport } from "./statusReport";
import { loadConversation, resetConversation, saveConversation } from "./store";
import type { ConversationContext, LoadedConversation, UploadedDocDraft } from "./types";
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

/**
 * Dipanggil begitu layanan (atau sub-jenis KK) dipilih - tampilkan daftar syarat DULU,
 * sebelum menanyakan nama pemohon. Supaya warga tahu apa yang perlu disiapkan sebelum
 * "berkomitmen" mengetik nama; kalau ternyata belum siap, tinggal ketik *batal*.
 */
async function offerServiceRequirements(
  sock: WASocket,
  waJid: string,
  conv: LoadedConversation,
  serviceType: ServiceType
): Promise<void> {
  const snapshot = await loadRequirementsSnapshot(serviceType);
  if (snapshot.length === 0) {
    await resetConversation(waJid);
    await reply(sock, waJid, MESSAGES.noRequirementsConfigured);
    return;
  }
  conv.step = "AWAIT_NAME";
  conv.requirementsSnapshot = snapshot;
  conv.context = { serviceType, uploadedDocs: [] };
  await saveConversation(conv);
  await reply(sock, waJid, serviceSelectedText(serviceLabel(serviceType), requirementsListText(snapshot)));
}

/**
 * Dipanggil begitu semua syarat sudah terkumpul - jangan langsung finalisasi, tampilkan
 * dulu ringkasan supaya warga bisa cek ulang / ganti salah satu file sebelum benar-benar
 * terkirim ke petugas. Step REVIEWING ini juga dipakai jalur "perbaiki <tiket>" (lihat
 * fixIntroText) - keduanya berujung ke interaksi tinjau-ulang yang sama persis.
 */
async function enterReviewing(sock: WASocket, waJid: string, conv: LoadedConversation): Promise<void> {
  conv.step = "REVIEWING";
  await saveConversation(conv);
  await reply(
    sock,
    waJid,
    reviewCompleteText(requirementsStatusListText(conv.requirementsSnapshot, conv.context.uploadedDocs))
  );
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

  // "perbaiki <nomor tiket>" - resubmit pengajuan yang DITOLAK tanpa harus kirim ulang
  // SEMUA syarat dari nol (syarat lama otomatis dipakai lagi, tinggal ganti yang bermasalah).
  const fixTicketMatch = text?.trim().match(/^perbaiki\s+(\S+)$/i);
  if (fixTicketMatch) {
    const result = await loadFixRejectedContext(waJid, fixTicketMatch[1]);
    if (!result.ok) {
      await reply(sock, waJid, result.message);
      return;
    }
    const conv = await loadConversation(waJid);
    await cleanupTempFiles(conv.context.uploadedDocs);
    conv.step = "REVIEWING";
    conv.requirementsSnapshot = result.context.requirementsSnapshot;
    conv.context = {
      serviceType: result.context.serviceType,
      applicantName: result.context.applicantName,
      uploadedDocs: result.context.uploadedDocs,
    };
    await saveConversation(conv);
    await reply(sock, waJid, fixIntroText(result.context));
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

    if (choice.serviceType === null) {
      // Kartu Keluarga dipilih - keperluannya beda-beda (barcode/pisah KK/tambah anggota),
      // syaratnya juga jauh berbeda, jadi tanya dulu sebelum lanjut ke nama pemohon.
      conv.step = "AWAIT_KK_SUBTYPE";
      conv.context = { uploadedDocs: [] };
      await saveConversation(conv);
      await reply(sock, waJid, kkSubmenuText());
      return;
    }

    await offerServiceRequirements(sock, waJid, conv, choice.serviceType);
    return;
  }

  if (conv.step === "AWAIT_KK_SUBTYPE") {
    const choice = text ? resolveKkSubmenuChoice(text) : undefined;
    if (!choice) {
      await reply(sock, waJid, kkSubmenuText());
      return;
    }
    await offerServiceRequirements(sock, waJid, conv, choice.serviceType);
    return;
  }

  if (conv.step === "AWAIT_NAME") {
    const name = text?.trim();
    if (!name || name.length < 3) {
      await reply(sock, waJid, MESSAGES.invalidName);
      return;
    }
    conv.context.applicantName = name;
    conv.step = "COLLECTING_DOCS";
    await saveConversation(conv);
    await reply(sock, waJid, startCollectingText(conv.requirementsSnapshot[0].name));
    return;
  }

  if (conv.step === "COLLECTING_DOCS") {
    const uploadedIds = conv.context.uploadedDocs.map((d) => d.requirementId);
    const pending = nextPendingRequirement(conv.requirementsSnapshot, uploadedIds);

    if (!pending) {
      // Sudah lengkap tapi entah kenapa belum masuk tinjau-ulang - jaga-jaga, jangan macet.
      await enterReviewing(sock, waJid, conv);
      return;
    }

    if (!hasSupportedMedia(msg)) {
      await reply(sock, waJid, MESSAGES.waitingForDocInsteadOfText(pending.name));
      return;
    }

    try {
      const draft = await intakeDocument(
        sock,
        msg,
        waJid,
        pending.id,
        pending.name,
        pending.ocrKtp,
        conv.context.serviceType ? serviceLabel(conv.context.serviceType) : "PENGAJUAN"
      );
      conv.context.uploadedDocs.push(draft);
      await saveConversation(conv);

      const stillPending = nextPendingRequirement(
        conv.requirementsSnapshot,
        conv.context.uploadedDocs.map((d) => d.requirementId)
      );

      if (!stillPending) {
        await enterReviewing(sock, waJid, conv);
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

  if (conv.step === "REVIEWING") {
    const filledIds = conv.context.uploadedDocs.map((d) => d.requirementId);
    const missing = conv.requirementsSnapshot.filter((r) => !filledIds.includes(r.id));

    if (normalized === "lanjut") {
      if (missing.length > 0) {
        await reply(
          sock,
          waJid,
          `Masih ada syarat yang belum lengkap:\n${missing.map((r) => `- ${r.name}`).join("\n")}\n\n` +
            `Mohon kirim dulu, atau ketik nomor syaratnya.`
        );
        return;
      }
      await finalizeAndReply(sock, waJid, waNumber, conv);
      return;
    }

    const pickNum = normalized ? Number(normalized) : NaN;
    if (Number.isInteger(pickNum) && pickNum >= 1 && pickNum <= conv.requirementsSnapshot.length) {
      conv.context.awaitingReplacementRequirementId = conv.requirementsSnapshot[pickNum - 1].id;
      await saveConversation(conv);
      await reply(sock, waJid, `Baik, mohon kirim file baru untuk syarat: *${conv.requirementsSnapshot[pickNum - 1].name}*`);
      return;
    }

    if (hasSupportedMedia(msg)) {
      const targetId = conv.context.awaitingReplacementRequirementId ?? missing[0]?.id;
      if (!targetId) {
        await reply(
          sock,
          waJid,
          `Semua syarat sudah lengkap.\n\n${requirementsStatusListText(conv.requirementsSnapshot, conv.context.uploadedDocs)}\n\n` +
            `Ketik *lanjut* untuk mengirim pengajuan, atau ketik nomor syarat yang mau diganti.`
        );
        return;
      }
      const targetItem = conv.requirementsSnapshot.find((r) => r.id === targetId)!;
      try {
        const draft = await intakeDocument(
          sock,
          msg,
          waJid,
          targetItem.id,
          targetItem.name,
          targetItem.ocrKtp,
          conv.context.serviceType ? serviceLabel(conv.context.serviceType) : "PENGAJUAN"
        );
        const oldEntry = conv.context.uploadedDocs.find((d) => d.requirementId === targetId);
        if (oldEntry) await fs.promises.unlink(oldEntry.tempFilePath).catch(() => undefined);
        conv.context.uploadedDocs = conv.context.uploadedDocs.filter((d) => d.requirementId !== targetId);
        conv.context.uploadedDocs.push(draft);
        conv.context.awaitingReplacementRequirementId = undefined;
        await saveConversation(conv);
        await reply(
          sock,
          waJid,
          `Syarat *${targetItem.name}* sudah diperbarui.\n\n${requirementsStatusListText(conv.requirementsSnapshot, conv.context.uploadedDocs)}\n\n` +
            `Ketik nomor syarat lain untuk mengganti, atau *lanjut* untuk mengirim pengajuan.`
        );
      } catch (err) {
        if (err instanceof MediaRejectedError) {
          await reply(sock, waJid, err.message);
        } else {
          logger.error({ err }, "Gagal memproses dokumen perbaikan");
          await reply(sock, waJid, "Terjadi kesalahan saat memproses file. Mohon kirim ulang.");
        }
      }
      return;
    }

    await reply(
      sock,
      waJid,
      `${requirementsStatusListText(conv.requirementsSnapshot, conv.context.uploadedDocs)}\n\n` +
        `Ketik nomor syarat yang mau diganti, atau *lanjut* kalau semua sudah benar.`
    );
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
