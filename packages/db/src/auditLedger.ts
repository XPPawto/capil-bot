import crypto from "crypto";
import { prisma } from "./index";

/**
 * Buku besar audit berantai (hash chain) untuk InboxMessage ("Pesan Masuk" di /admin-xpawto) -
 * dipakai membuktikan riwayat chat tidak diubah di luar jalur resmi aplikasi (mis. lewat SQL
 * manual langsung ke database, bukan lewat kode yang sudah ada di repo ini). Dipakai BERSAMA
 * dari dua proses terpisah (apps/bot MAUPUN apps/web, keduanya bisa membuat InboxMessage baru -
 * lihat komentar @unique di schema.prisma untuk cara amannya).
 *
 * Cara kerja: setiap baris InboxMessage yang dibuat/diedit/berubah status memicu SATU entri
 * ledger baru. Entri itu "mengunci" dirinya ke entri SEBELUMNYA lewat prevHash (hash entri
 * sebelumnya), lalu hash dirinya sendiri dihitung dari HMAC-SHA256(kunci rahasia server,
 * prevHash + isi entri ini). Karena HMAC pakai kunci rahasia yang CUMA ada di .env server
 * (tidak pernah masuk git, tidak diketahui siapa pun yang cuma punya akses ke kode/database),
 * siapa pun yang mengubah isi satu baris InboxMessage ATAU satu baris ledger secara langsung
 * (tanpa lewat kode ini) akan membuat hash-nya tidak lagi cocok kalau dihitung ulang - dan
 * karena tiap entri mengunci ke entri sebelumnya, mengubah SATU entri lama membuat SEMUA
 * entri setelahnya ikut tidak valid saat diverifikasi (lihat verifyLedgerChain).
 *
 * KETERBATASAN YANG PENTING DIPAHAMI: ledger ini baru mulai mencatat sejak fitur ini
 * diaktifkan. Baris InboxMessage yang sudah ada SEBELUM itu di-backfill satu kali (lihat
 * packages/db/scripts/backfillAuditLedger.ts) berdasarkan kondisinya SAAT backfill
 * dijalankan - ini TIDAK membuktikan baris itu belum pernah diubah SEBELUM backfill (memang
 * mustahil dibuktikan tanpa hash yang diambil sejak awal). Yang bisa dibuktikan dengan pasti
 * adalah: tidak ada perubahan APA PUN pada baris mana pun (lama maupun baru) SEJAK ledger ini
 * aktif.
 */

const ALGORITHM = "sha256";
export const GENESIS_HASH = "0".repeat(64);

function getLedgerKey(): Buffer {
  const raw = process.env.AUDIT_LEDGER_KEY;
  if (!raw) throw new Error("AUDIT_LEDGER_KEY belum diset di .env");
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) throw new Error("AUDIT_LEDGER_KEY harus 64 karakter hex (32 byte)");
  return key;
}

function computeHash(prevHash: string, eventType: string, inboxMessageId: number, payload: string, createdAtIso: string): string {
  const canonical = `${prevHash}|${eventType}|${inboxMessageId}|${payload}|${createdAtIso}`;
  return crypto.createHmac(ALGORITHM, getLedgerKey()).update(canonical).digest("hex");
}

export type LedgerEventType = "MESSAGE_CREATED" | "MESSAGE_EDITED" | "STATUS_CHANGED" | "MESSAGE_DELETED" | "LIVE_LOCATION_UPDATED" | "REACTION_CHANGED";

export interface MessageCreatedPayload {
  waJid: string;
  waNumber: string;
  channel: string;
  extraAccountId: number | null;
  direction: string;
  message: string;
  attachmentPath: string | null;
  attachmentMimeType: string | null;
  attachmentSha256: string | null;
  isGroup: boolean;
  isChannel: boolean;
  groupName: string | null;
  senderNumber: string | null;
  senderName: string | null;
  adminId: number | null;
  waMessageId: string | null;
  createdAt: string;
  latitude?: number | null;
  longitude?: number | null;
  isForwarded?: boolean;
  quotedWaMessageId?: string | null;
  quotedPreview?: string | null;
}

export interface MessageEditedPayload {
  newMessage: string;
  editedAt: string;
}

export interface StatusChangedPayload {
  newStatus: string;
}

/** protocolMessage tipe REVOKE - lihat applyMessageDelete di apps/bot/src/conversation/messageLog.ts. */
export interface MessageDeletedPayload {
  deletedAt: string;
}

/** Update posisi live location berikutnya (bukan share baru) - lihat applyLiveLocationUpdate
 * di apps/bot/src/conversation/messageLog.ts. */
export interface LiveLocationUpdatedPayload {
  newMessage: string;
  latitude: number;
  longitude: number;
  updatedAt: string;
}

/** Reaksi emoji satu pereaksi ke satu pesan berubah (ditambah/diganti/dibatalkan - emoji=""
 * berarti dibatalkan) - lihat applyMessageReaction di apps/bot/src/conversation/messageLog.ts. */
export interface ReactionChangedPayload {
  reactorJid: string;
  reactorName: string | null;
  emoji: string;
  updatedAt: string;
}

// CATATAN DARI PROSES MENCARI MEKANISME YANG BENAR (dua percobaan sebelumnya GAGAL, sengaja
// dicatat di sini supaya tidak diulang lagi kalau kode ini disentuh lagi nanti):
//  1. Optimistic retry (baca, coba simpan, kalau bentrok baca ulang & coba lagi) - TERBUKTI
//     kehabisan percobaan dan meninggalkan celah PERMANEN saat banyak event datang beruntun.
//  2. GET_LOCK MySQL (mutual-exclusion lintas proses) - waktu eksekusinya SUDAH benar
//     terserialisasi (dibuktikan lewat stress test manual), TAPI pembacaan "hash terakhir"
//     di dalamnya tetap kena snapshot BEKU dari isolasi default MySQL (REPEATABLE READ) -
//     snapshot itu diambil saat transaksi MULAI, sebelum sekalipun menunggu giliran GET_LOCK,
//     jadi begitu akhirnya dapat giliran, yang terbaca tetap bukan data yang paling baru.
//     Mencoba mengubah isolation level ke READ COMMITTED (baik manual maupun lewat opsi
//     Prisma) TIDAK berpengaruh - diverifikasi lewat SELECT @@transaction_isolation, tetap
//     REPEATABLE-READ, kemungkinan keterbatasan Prisma 5.22 dengan provider MySQL.
// Solusi yang BENAR-BENAR terbukti (lewat stress test 25 panggilan bersamaan, 0 gagal):
// `SELECT ... FOR UPDATE` pada satu baris (AuditLedgerTail) - locking read InnoDB SELALU
// membaca versi TERBARU yang sudah commit, tidak peduli isolation level/snapshot sama sekali
// (beda mendasar dari SELECT biasa) - jadi baik mutual-exclusion MAUPUN kesegaran data
// terjamin sekaligus oleh satu mekanisme yang sama.
export async function appendLedgerEntry(
  eventType: LedgerEventType,
  inboxMessageId: number,
  payload: MessageCreatedPayload | MessageEditedPayload | StatusChangedPayload | MessageDeletedPayload | LiveLocationUpdatedPayload | ReactionChangedPayload
): Promise<void> {
  const payloadJson = JSON.stringify(payload);

  await prisma.$transaction(async (tx) => {
    const [{ lastHash }] = await tx.$queryRaw<{ lastHash: string }[]>`SELECT lastHash FROM AuditLedgerTail WHERE id = 1 FOR UPDATE`;
    const prevHash = lastHash;
    const createdAt = new Date();
    const hash = computeHash(prevHash, eventType, inboxMessageId, payloadJson, createdAt.toISOString());
    await tx.auditLedgerEntry.create({
      data: { eventType, inboxMessageId, payload: payloadJson, prevHash, hash, createdAt },
    });
    await tx.auditLedgerTail.update({ where: { id: 1 }, data: { lastHash: hash } });
  });
}

export interface ChainCheckResult {
  ok: boolean;
  totalEntries: number;
  brokenAtId?: number;
  reason?: string;
}

/**
 * Jalan urut dari entri pertama, pastikan tiap prevHash memang persis hash entri sebelumnya
 * (GENESIS_HASH untuk entri pertama), dan tiap hash memang benar hasil HMAC dari isi entri
 * itu sendiri. Kalau SATU saja baris (lama atau ledger) pernah diubah di luar jalur resmi,
 * pemeriksaan ini berhenti persis di titik itu.
 */
export async function verifyLedgerChain(): Promise<ChainCheckResult> {
  const entries = await prisma.auditLedgerEntry.findMany({ orderBy: { id: "asc" } });
  let expectedPrev = GENESIS_HASH;
  for (const e of entries) {
    if (e.prevHash !== expectedPrev) {
      return { ok: false, totalEntries: entries.length, brokenAtId: e.id, reason: "prevHash tidak menyambung ke entri sebelumnya - rantai terputus/dicabang" };
    }
    const recomputed = computeHash(e.prevHash, e.eventType, e.inboxMessageId, e.payload, e.createdAt.toISOString());
    if (recomputed !== e.hash) {
      return { ok: false, totalEntries: entries.length, brokenAtId: e.id, reason: "hash tidak cocok - isi entri ledger ini sudah diubah" };
    }
    expectedPrev = e.hash;
  }
  return { ok: true, totalEntries: entries.length };
}

export interface LiveStateMismatch {
  inboxMessageId: number;
  field: string;
  expected: string | null;
  actual: string | null;
}

/**
 * Untuk tiap InboxMessage yang punya jejak di ledger, "putar ulang" seluruh event-nya
 * (CREATED, lalu tiap EDITED/LIVE_LOCATION_UPDATED berurutan, lalu STATUS_CHANGED &
 * MESSAGE_DELETED terakhir) untuk tahu isi yang SEHARUSNYA ada di baris itu sekarang - lalu
 * dibandingkan ke isi baris InboxMessage yang SESUNGGUHNYA di database. Beda berarti baris
 * itu diubah langsung (SQL manual), tanpa lewat ledger sama sekali - satu-satunya cara
 * mengubah data yang tidak akan terdeteksi rantai hash di atas sendirian (karena ledgernya
 * sendiri tidak disentuh).
 */
export async function crossCheckLiveState(): Promise<{ mismatches: LiveStateMismatch[]; attachmentChecks: { inboxMessageId: number; attachmentPath: string; expectedSha256: string }[] }> {
  const entries = await prisma.auditLedgerEntry.findMany({ orderBy: { id: "asc" } });
  const byMessage = new Map<number, typeof entries>();
  for (const e of entries) {
    const list = byMessage.get(e.inboxMessageId) ?? [];
    list.push(e);
    byMessage.set(e.inboxMessageId, list);
  }

  const mismatches: LiveStateMismatch[] = [];
  const attachmentChecks: { inboxMessageId: number; attachmentPath: string; expectedSha256: string }[] = [];

  const ids = [...byMessage.keys()];
  const rows = await prisma.inboxMessage.findMany({ where: { id: { in: ids } } });
  const rowById = new Map(rows.map((r) => [r.id, r]));

  for (const [inboxMessageId, events] of byMessage) {
    const row = rowById.get(inboxMessageId);
    if (!row) {
      mismatches.push({ inboxMessageId, field: "row", expected: "ada", actual: "TIDAK ADA (baris hilang/dihapus)" });
      continue;
    }

    let expectedMessage: string | undefined;
    let expectedEditedAt: string | null = null;
    let expectedStatus: string | null = null;
    let expectedAttachmentSha256: string | null = null;
    let expectedAttachmentPath: string | null = null;
    let expectedDeletedAt: string | null = null;
    let expectedLatitude: number | null = null;
    let expectedLongitude: number | null = null;
    let expectedIsForwarded: boolean | undefined;
    let expectedQuotedWaMessageId: string | null = null;
    let expectedQuotedPreview: string | null = null;
    // Reaksi terakhir PER PEREAKSI (bukan satu nilai tunggal seperti field lain) - satu
    // pesan bisa direaksi banyak orang sekaligus, masing-masing punya "keadaan terakhir"
    // sendiri-sendiri (emoji="" berarti pereaksi itu sudah membatalkan reaksinya).
    const expectedReactions = new Map<string, { emoji: string; reactorName: string | null }>();

    for (const e of events) {
      const payload = JSON.parse(e.payload);
      if (e.eventType === "MESSAGE_CREATED") {
        expectedMessage = payload.message;
        expectedAttachmentSha256 = payload.attachmentSha256 ?? null;
        expectedAttachmentPath = payload.attachmentPath ?? null;
        expectedLatitude = payload.latitude ?? null;
        expectedLongitude = payload.longitude ?? null;
        expectedIsForwarded = payload.isForwarded ?? false;
        expectedQuotedWaMessageId = payload.quotedWaMessageId ?? null;
        expectedQuotedPreview = payload.quotedPreview ?? null;
      } else if (e.eventType === "MESSAGE_EDITED") {
        expectedMessage = payload.newMessage;
        expectedEditedAt = payload.editedAt;
      } else if (e.eventType === "STATUS_CHANGED") {
        expectedStatus = payload.newStatus;
      } else if (e.eventType === "MESSAGE_DELETED") {
        expectedDeletedAt = payload.deletedAt;
      } else if (e.eventType === "LIVE_LOCATION_UPDATED") {
        expectedMessage = payload.newMessage;
        expectedLatitude = payload.latitude;
        expectedLongitude = payload.longitude;
      } else if (e.eventType === "REACTION_CHANGED") {
        expectedReactions.set(payload.reactorJid, { emoji: payload.emoji, reactorName: payload.reactorName ?? null });
      }
    }

    if (expectedMessage !== undefined && expectedMessage !== row.message) {
      mismatches.push({ inboxMessageId, field: "message", expected: expectedMessage, actual: row.message });
    }
    const actualEditedAtIso = row.editedAt ? row.editedAt.toISOString() : null;
    if (expectedEditedAt !== null && expectedEditedAt !== actualEditedAtIso) {
      mismatches.push({ inboxMessageId, field: "editedAt", expected: expectedEditedAt, actual: actualEditedAtIso });
    }
    if (expectedStatus !== null && expectedStatus !== row.status) {
      mismatches.push({ inboxMessageId, field: "status", expected: expectedStatus, actual: row.status });
    }
    if (expectedAttachmentPath && expectedAttachmentPath !== row.attachmentPath) {
      mismatches.push({ inboxMessageId, field: "attachmentPath", expected: expectedAttachmentPath, actual: row.attachmentPath });
    }
    if (expectedAttachmentSha256 && row.attachmentPath) {
      attachmentChecks.push({ inboxMessageId, attachmentPath: row.attachmentPath, expectedSha256: expectedAttachmentSha256 });
    }
    const actualDeletedAtIso = row.deletedAt ? row.deletedAt.toISOString() : null;
    if (expectedDeletedAt !== null && expectedDeletedAt !== actualDeletedAtIso) {
      mismatches.push({ inboxMessageId, field: "deletedAt", expected: expectedDeletedAt, actual: actualDeletedAtIso });
    }
    // Toleransi epsilon kecil, bukan perbandingan float persis bit-demi-bit - IEEE 754 double
    // seharusnya round-trip persis lewat JSON+MySQL DOUBLE, tapi tetap lebih aman berjaga-jaga
    // daripada salah lapor "tidak cocok" gara-gara pembulatan yang sebenarnya tidak berarti apa-apa.
    const EPSILON = 1e-9;
    if (expectedLatitude != null && (row.latitude == null || Math.abs(expectedLatitude - row.latitude) > EPSILON)) {
      mismatches.push({ inboxMessageId, field: "latitude", expected: String(expectedLatitude), actual: row.latitude != null ? String(row.latitude) : null });
    }
    if (expectedLongitude != null && (row.longitude == null || Math.abs(expectedLongitude - row.longitude) > EPSILON)) {
      mismatches.push({ inboxMessageId, field: "longitude", expected: String(expectedLongitude), actual: row.longitude != null ? String(row.longitude) : null });
    }
    if (expectedIsForwarded !== undefined && expectedIsForwarded !== row.isForwarded) {
      mismatches.push({ inboxMessageId, field: "isForwarded", expected: String(expectedIsForwarded), actual: String(row.isForwarded) });
    }
    if (expectedQuotedWaMessageId !== null && expectedQuotedWaMessageId !== row.quotedWaMessageId) {
      mismatches.push({ inboxMessageId, field: "quotedWaMessageId", expected: expectedQuotedWaMessageId, actual: row.quotedWaMessageId });
    }
    if (expectedQuotedPreview !== null && expectedQuotedPreview !== row.quotedPreview) {
      mismatches.push({ inboxMessageId, field: "quotedPreview", expected: expectedQuotedPreview, actual: row.quotedPreview });
    }

    if (expectedReactions.size > 0) {
      const actualRows = await prisma.messageReaction.findMany({ where: { inboxMessageId } });
      const actualByReactor = new Map(actualRows.map((r) => [r.reactorJid, r.emoji]));
      for (const [reactorJid, expected] of expectedReactions) {
        const actualEmoji = actualByReactor.get(reactorJid) ?? "";
        if (expected.emoji !== actualEmoji) {
          mismatches.push({
            inboxMessageId,
            field: `reaction:${reactorJid}`,
            expected: expected.emoji || "(dibatalkan)",
            actual: actualEmoji || "(dibatalkan)",
          });
        }
      }
    }
  }

  return { mismatches, attachmentChecks };
}
