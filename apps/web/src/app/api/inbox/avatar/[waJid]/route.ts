import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { decryptBuffer } from "@/lib/fileEncryption";
import { fetchAvatarFromBot } from "@/lib/botClient";
import { prisma } from "@/lib/prisma";
import type { InboxChannel } from "@prisma/client";

const UPLOAD_DIR = path.resolve(process.cwd(), "../..", process.env.UPLOAD_DIR ?? "./storage/uploads");

// Foto profil jarang berubah - cache 3 hari per kontak supaya kita tidak memanggil server
// WA (lewat bot) tiap kali halaman /admin-xpawto dibuka. Lihat komentar model
// ContactAvatar di schema.prisma untuk alasan lengkap.
const REFRESH_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function channelFrom(value: string | null): InboxChannel {
  return value === "EXTRA" ? "EXTRA" : "SERVICE";
}

/**
 * Menyajikan foto profil/ikon grup kontak, dengan cache-lalu-ambil-kalau-basi. `extraAccountId`
 * sentinel 0 dipakai untuk channel SERVICE (lihat komentar model ContactAvatar - MySQL tidak
 * menganggap NULL sama dengan NULL lain di unique index gabungan, jadi sengaja tidak nullable).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ waJid: string }> }
): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const { waJid } = await params;
  const decodedWaJid = decodeURIComponent(waJid);
  const channel = channelFrom(req.nextUrl.searchParams.get("channel"));
  const extraAccountIdParam = req.nextUrl.searchParams.get("extraAccountId");
  const extraAccountIdSentinel = channel === "EXTRA" ? Number(extraAccountIdParam ?? 0) || 0 : 0;

  let cached = await prisma.contactAvatar.findUnique({
    where: {
      waJid_channel_extraAccountId: { waJid: decodedWaJid, channel, extraAccountId: extraAccountIdSentinel },
    },
  });

  const isStale = !cached || Date.now() - cached.fetchedAt.getTime() > REFRESH_TTL_MS;
  if (isStale) {
    const result = await fetchAvatarFromBot(
      decodedWaJid,
      channel,
      channel === "EXTRA" ? extraAccountIdSentinel : undefined
    );
    // `result` null berarti bot tidak terjangkau/gagal - baris cache LAMA (kalau ada)
    // sengaja dibiarkan apa adanya (fetchedAt tidak diperbarui) supaya kunjungan berikutnya
    // mencoba lagi segera, bukan menunggu TTL 3 hari penuh.
    if (result) {
      cached = await prisma.contactAvatar.upsert({
        where: {
          waJid_channel_extraAccountId: { waJid: decodedWaJid, channel, extraAccountId: extraAccountIdSentinel },
        },
        create: {
          waJid: decodedWaJid,
          channel,
          extraAccountId: extraAccountIdSentinel,
          imagePath: result.relativePath,
          mimeType: result.mimeType,
        },
        update: { imagePath: result.relativePath, mimeType: result.mimeType, fetchedAt: new Date() },
      });
    }
  }

  if (!cached || !cached.imagePath) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const absolutePath = path.resolve(UPLOAD_DIR, cached.imagePath);
  if (!absolutePath.startsWith(UPLOAD_DIR + path.sep)) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  let rawBuffer: Buffer;
  try {
    const encrypted = await fs.promises.readFile(absolutePath);
    rawBuffer = decryptBuffer(encrypted);
  } catch {
    return NextResponse.json({ error: "file_missing" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(rawBuffer), {
    headers: {
      "content-type": cached.mimeType ?? "image/jpeg",
      // Browser boleh cache 1 hari - server sendiri sudah punya TTL 3 hari di atas, jadi
      // gambar tidak akan "basi" berkepanjangan walau browser ikut menyimpannya.
      "cache-control": "private, max-age=86400",
    },
  });
}
