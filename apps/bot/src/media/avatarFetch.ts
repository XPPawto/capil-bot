import fs from "fs";
import path from "path";
import type { InboxChannel } from "@kelurahan/db";
import { getSocket } from "../wa/socket";
import { getExtraAccountSocket } from "../wa/extraAccountManager";
import { config } from "../config";
import { logger } from "../logger";
import { encryptBuffer } from "./fileEncryption";

export interface AvatarFetchResult {
  hasPhoto: boolean;
  relativePath: string | null;
  mimeType: string | null;
}

const NO_PHOTO: AvatarFetchResult = { hasPhoto: false, relativePath: null, mimeType: null };

// Antrean serial - kalau dashboard baru dibuka dan puluhan kontak sekaligus minta foto
// profil (cache masih kosong), TANPA ini semuanya akan memanggil server WA nyaris
// bersamaan, pola yang persis dikhawatirkan dokumentasi proyek ini soal "pemakaian otomatis
// mencurigakan". Dengan antrean + jeda kecil acak antar permintaan, panggilan ke WA jadi
// satu-satu berurutan seperti pola pemakaian manusia biasa - lambat dikit, tapi aman.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  const pace = () => new Promise<void>((resolve) => setTimeout(resolve, 200 + Math.random() * 250));
  queue = run.then(pace, pace);
  return run;
}

/**
 * Ambil foto profil (atau ikon grup, JID `@g.us` bekerja sama saja lewat fungsi Baileys
 * yang sama) langsung dari WA lewat socket channel/akun yang sesuai, simpan TERENKRIPSI ke
 * disk (sama seperti semua media lain di proyek ini - lihat media/inboxMedia.ts), lalu
 * kembalikan metadatanya ke pemanggil (control server -> web). Web-lah yang menyimpan
 * cache-nya sendiri di tabel ContactAvatar dan bertanggung jawab TIDAK memanggil fungsi ini
 * terlalu sering (lihat komentar model ContactAvatar di schema.prisma) - panggilan yang
 * memang terlanjur masuk beruntun (mis. buka halaman pertama kali) tetap diserialkan aman
 * lewat antrean di atas.
 */
export async function fetchAndCacheAvatar(
  channel: InboxChannel,
  extraAccountId: number | undefined,
  waJid: string
): Promise<AvatarFetchResult> {
  return enqueue(() => doFetchAndCacheAvatar(channel, extraAccountId, waJid));
}

async function doFetchAndCacheAvatar(
  channel: InboxChannel,
  extraAccountId: number | undefined,
  waJid: string
): Promise<AvatarFetchResult> {
  const sock = channel === "EXTRA" && extraAccountId ? getExtraAccountSocket(extraAccountId) : getSocket();
  if (!sock) {
    throw new Error("Socket WA untuk channel/akun ini belum terhubung");
  }

  let url: string | undefined;
  try {
    url = await sock.profilePictureUrl(waJid, "image");
  } catch (err) {
    // Baileys melempar error kalau memang tidak ada foto profil (atau privasi membatasi
    // siapa yang boleh lihat) - ini kondisi NORMAL (kebanyakan kontak), bukan kegagalan,
    // jadi cukup dianggap "tidak ada foto" tanpa log level error/warn.
    logger.debug({ err, waJid, channel, extraAccountId }, "Tidak ada foto profil untuk kontak/grup ini");
    return NO_PHOTO;
  }
  if (!url) return NO_PHOTO;

  const res = await fetch(url);
  if (!res.ok) {
    logger.warn({ waJid, status: res.status }, "Gagal mengunduh foto profil dari CDN WhatsApp");
    return NO_PHOTO;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type") || "image/jpeg";
  const ext = mimeType.includes("png") ? "png" : "jpg";

  const safeJid = waJid.replace(/[^a-zA-Z0-9._@-]/g, "_");
  const destDir = path.join(config.uploadDir, "_avatars");
  await fs.promises.mkdir(destDir, { recursive: true });
  // Nama file DETERMINISTIK (bukan randomUUID seperti lampiran pesan biasa) - avatar tidak
  // perlu riwayat versi, satu file per (channel, akun, kontak) cukup ditimpa tiap refresh.
  const fileName = `${channel}_${extraAccountId ?? 0}_${safeJid}.${ext}`;
  await fs.promises.writeFile(path.join(destDir, fileName), encryptBuffer(buffer));

  return { hasPhoto: true, relativePath: path.join("_avatars", fileName), mimeType };
}
