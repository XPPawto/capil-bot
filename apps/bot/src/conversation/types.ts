import type { ServiceType } from "@kelurahan/db";

export type ConversationStep = "IDLE" | "AWAIT_KK_SUBTYPE" | "AWAIT_NAME" | "COLLECTING_DOCS" | "REVIEWING";

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
  /// Diisi saat step REVIEWING menunggu warga mengirim file pengganti untuk syarat
  /// tertentu yang dipilih lewat nomor - dikosongkan lagi setelah file itu diterima.
  awaitingReplacementRequirementId?: number;
}

export interface LoadedConversation {
  waJid: string;
  step: ConversationStep;
  requirementsSnapshot: RequirementSnapshotItem[];
  context: ConversationContext;
}
