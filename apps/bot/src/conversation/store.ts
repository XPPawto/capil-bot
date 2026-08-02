import { prisma } from "@kelurahan/db";
import { config } from "../config";
import type { ConversationContext, ConversationStep, LoadedConversation, RequirementSnapshotItem } from "./types";

function emptyContext(): ConversationContext {
  return { uploadedDocs: [] };
}

function expiresAt(): Date {
  return new Date(Date.now() + config.conversationTtlHours * 60 * 60 * 1000);
}

export async function loadConversation(waJid: string): Promise<LoadedConversation> {
  const row = await prisma.conversationState.findUnique({ where: { waJid } });
  if (!row) {
    return { waJid, step: "IDLE", requirementsSnapshot: [], context: emptyContext() };
  }
  return {
    waJid,
    step: row.state as ConversationStep,
    requirementsSnapshot: (row.requirementsSnapshot as unknown as RequirementSnapshotItem[]) ?? [],
    context: (row.contextJson as unknown as ConversationContext) ?? emptyContext(),
  };
}

export async function saveConversation(conv: LoadedConversation): Promise<void> {
  await prisma.conversationState.upsert({
    where: { waJid: conv.waJid },
    update: {
      state: conv.step,
      requirementsSnapshot: conv.requirementsSnapshot as any,
      contextJson: conv.context as any,
      expiresAt: expiresAt(),
      // Reset tiap ada interaksi nyata, supaya kalau warga sempat lanjut lalu berhenti lagi
      // di lain waktu, reminder "belum selesai" bisa terkirim ulang (bukan cuma sekali seumur
      // percakapan).
      reminderSentAt: null,
    },
    create: {
      waJid: conv.waJid,
      state: conv.step,
      requirementsSnapshot: conv.requirementsSnapshot as any,
      contextJson: conv.context as any,
      expiresAt: expiresAt(),
    },
  });
}

export async function resetConversation(waJid: string): Promise<void> {
  await prisma.conversationState.upsert({
    where: { waJid },
    update: { state: "IDLE" satisfies ConversationStep, requirementsSnapshot: [], contextJson: emptyContext() as any, expiresAt: expiresAt() },
    create: { waJid, state: "IDLE" satisfies ConversationStep, requirementsSnapshot: [], contextJson: emptyContext() as any, expiresAt: expiresAt() },
  });
}
