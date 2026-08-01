import fs from "fs";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { logger } from "../logger";
import { downloadAndValidate, hasSupportedMedia, MediaRejectedError } from "../media/download";
import { finalizeRequest } from "../media/finalize";
import { notifyStaffNewRequest } from "../notify/notifyStaff";
import { mainMenuText, resolveServiceChoice } from "./menu";
import { MESSAGES, startCollectingText } from "./messages";
import { loadRequirementsSnapshot, nextPendingRequirement, requirementsListText } from "./requirements";
import { buildStatusReport } from "./statusReport";
import { loadConversation, resetConversation, saveConversation } from "./store";
import type { ConversationContext, UploadedDocDraft } from "./types";

async function cleanupTempFiles(docs: UploadedDocDraft[]): Promise<void> {
  await Promise.all(
    docs.map((doc) => fs.promises.unlink(doc.tempFilePath).catch(() => undefined))
  );
}

async function reply(sock: WASocket, waJid: string, text: string): Promise<void> {
  await sock.sendMessage(waJid, { text });
}

export async function handleConversationMessage(
  sock: WASocket,
  waJid: string,
  waNumber: string,
  text: string | undefined,
  msg: WAMessage
): Promise<void> {
  const normalized = text?.trim().toLowerCase();

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
    const choice = text ? resolveServiceChoice(text) : undefined;
    if (!choice) {
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
      conv.context.uploadedDocs.push({
        requirementId: pending.id,
        requirementName: pending.name,
        tempFilePath: downloaded.tempFilePath,
        fileName: downloaded.fileName,
        mimeType: downloaded.mimeType,
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
  await reply(sock, waJid, MESSAGES.submitted(result.ticketNumber));

  await notifyStaffNewRequest(sock, {
    ticketNumber: result.ticketNumber,
    serviceType: conv.context.serviceType!,
    applicantName: conv.context.applicantName!,
    waNumber,
  }).catch((err) => logger.error({ err }, "Gagal mengirim notifikasi pengajuan baru ke petugas"));
}
