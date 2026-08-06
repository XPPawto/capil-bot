import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { sendInboxFile } from "@/lib/botClient";
import { prisma } from "@/lib/prisma";
import { appendLedgerEntry } from "@kelurahan/db";
import type { InboxChannel } from "@prisma/client";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Kirim foto/dokumen ke warga dari halaman Pesan Masuk. Untuk channel SERVICE, wajib sudah
 * "Ambil Alih" percakapan ini dulu (sama seperti balasan teks di route ../messages) supaya
 * bot tidak ikut membalas otomatis bersamaan. Channel EXTRA tidak punya bot sama sekali
 * jadi tidak butuh syarat itu - tapi butuh `extraAccountId` untuk tahu socket mana yang dipakai.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ waJid: string }> }
): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const { waJid } = await params;
  const decodedWaJid = decodeURIComponent(waJid);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const channel: InboxChannel = form?.get("channel") === "EXTRA" ? "EXTRA" : "SERVICE";
  const extraAccountIdRaw = form?.get("extraAccountId");
  const extraAccountId = typeof extraAccountIdRaw === "string" && extraAccountIdRaw ? Number(extraAccountIdRaw) : undefined;

  if (channel === "SERVICE") {
    const takeover = await prisma.humanTakeover.findUnique({ where: { waJid: decodedWaJid } });
    if (!takeover) {
      return NextResponse.json({ error: "takeover_required" }, { status: 409 });
    }
  }

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: "unsupported_type" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 400 });
  }

  // waNumber diutamakan dari pesan MASUK (selalu benar, lewat senderPn) - lihat komentar
  // serupa di ../messages/route.ts untuk alasan urutan prioritasnya.
  let waNumber: string | undefined;
  const inboundInbox = await prisma.inboxMessage.findFirst({
    where: { waJid: decodedWaJid, direction: "INBOUND" },
    orderBy: { createdAt: "desc" },
  });
  waNumber = inboundInbox?.waNumber;
  if (!waNumber) {
    const existingRequest = await prisma.request.findFirst({ where: { waJid: decodedWaJid } });
    waNumber = existingRequest?.waNumber;
  }
  if (!waNumber) {
    const anyInbox = await prisma.inboxMessage.findFirst({ where: { waJid: decodedWaJid } });
    waNumber = anyInbox?.waNumber;
  }
  if (!waNumber) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileBase64 = buffer.toString("base64");

  const result = await sendInboxFile(decodedWaJid, file.name, file.type, fileBase64, channel, extraAccountId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "send_failed" }, { status: 502 });
  }

  const row = await prisma.inboxMessage.create({
    data: {
      waJid: decodedWaJid,
      waNumber,
      channel,
      extraAccountId,
      direction: "OUTBOUND",
      message: `[File dikirim: ${file.name}]`,
      adminId: guard.admin.id,
      waMessageId: result.waMessageId,
      status: result.waMessageId ? "SENT" : undefined,
    },
  });

  // Sama seperti ../messages/route.ts - jejak ledger wajib ada untuk setiap baris, termasuk
  // yang dibuat dari sisi web ini. Sidik jari isi file yang dikirim ikut dicatat sebagai
  // metadata (baris ini sendiri tidak menyimpan file-nya ke disk - cuma catatan teks).
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
      attachmentSha256: crypto.createHash("sha256").update(buffer).digest("hex"),
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
    console.error("GAGAL menulis jejak audit ledger untuk file yang dikirim dari dashboard", err);
  }

  return NextResponse.json({ ok: true });
}
