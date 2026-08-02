import type { ServiceType } from "@kelurahan/db";

export type ConversationStep = "IDLE" | "AWAIT_NAME" | "COLLECTING_DOCS";

export interface RequirementSnapshotItem {
  id: number;
  name: string;
  order: number;
  ocrKtp: boolean;
}

export interface UploadedDocDraft {
  requirementId: number;
  requirementName: string;
  tempFilePath: string;
  fileName: string;
  mimeType: string;
  ocrNik?: string;
  ocrRawText?: string;
}

export interface ConversationContext {
  serviceType?: ServiceType;
  applicantName?: string;
  uploadedDocs: UploadedDocDraft[];
}

export interface LoadedConversation {
  waJid: string;
  step: ConversationStep;
  requirementsSnapshot: RequirementSnapshotItem[];
  context: ConversationContext;
}
