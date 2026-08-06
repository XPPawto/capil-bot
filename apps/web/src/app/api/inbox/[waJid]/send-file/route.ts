import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiGuard";
import { sendInboxFile } from "@/lib/botClient";
import { prisma } from "@/lib/prisma";
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
  const guard = await requireAdmin();
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

  const existingInbox = await prisma.inboxMessage.findFirst({ where: { waJid: decodedWaJid } });
  const existingRequest = existingInbox ? null : await prisma.request.findFirst({ where: { waJid: decodedWaJid } });
  const waNumber = existingInbox?.waNumber ?? existingRequest?.waNumber;
  if (!waNumber) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileBase64 = buffer.toString("base64");

  const result = await sendInboxFile(decodedWaJid, file.name, file.type, fileBase64, channel, extraAccountId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "send_failed" }, { status: 502 });
  }

  await prisma.inboxMessage.create({
    data: {
      waJid: decodedWaJid,
      waNumber,
      channel,
      extraAccountId,
      direction: "OUTBOUND",
      message: `[File dikirim: ${file.name}]`,
      adminId: guard.admin.id,
    },
  });

  return NextResponse.json({ ok: true });
}
