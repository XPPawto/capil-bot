import { prisma, unlockMasterFor, lockMasterNow, isMasterUnlocked } from "@kelurahan/db";
import { config } from "../config";
import { logger } from "../logger";
import { getExtraAccountRuntimeStatus } from "../wa/extraAccountManager";
import { TELEGRAM_NOTIFY_ACCOUNT_ID } from "./telegramNotify";

/**
 * Sisi PERINTAH (menerima) dari bot Telegram - beda dari telegramNotify.ts yang murni SATU
 * ARAH (kirim notifikasi saja, tidak pernah baca pesan masuk Telegram). Long-polling
 * `getUpdates` dipakai (bukan webhook) supaya tidak perlu membuka endpoint publik baru sama
 * sekali - persis pola yang sudah dipakai proyek ini untuk semua panggilan Telegram lain
 * (selalu KELUAR ke api.telegram.org, tidak pernah menerima koneksi masuk dari internet).
 * Mencakup dua kelompok perintah: sakelar gembok /admin-xpawto (/unlock, /lock, /status) dan
 * pengecekan status Akun Kedua (/cekstatus).
 *
 * KEAMANAN: hanya pesan dari chat ID PEMILIK yang SUDAH DIKONFIGURASI (TELEGRAM_NOTIFY_CHAT_ID)
 * yang dianggap sah - siapa pun lain yang kebetulan tahu username bot ini TIDAK BISA membuka
 * gembok /admin-xpawto ataupun mengintip status akun cuma dengan mengirim pesan. Ini
 * satu-satunya baris yang benar-benar menjaga keamanan seluruh fitur ini, lihat handleUpdate
 * di bawah.
 */

let polling = false;
let updateOffset = 0;

const DURATION_RE = /^(\d+)\s*(s|m|h|d)$/i;
// Durasinya SENGAJA bebas (permintaan pemilik - bukan dipatok ke satu angka tertentu
// seperti 5 menit) - satu-satunya batas di sini murni jaga-jaga angka tidak masuk akal
// (typo nol kebanyakan dsb), BUKAN pembatasan keamanan. Kalau pemiliknya mau buka
// berhari-hari, itu keputusannya sendiri - /lock tetap selalu bisa dipakai kapan saja untuk
// menutup lebih cepat dari durasi manapun yang dipilih.
const MAX_UNLOCK_MS = 365 * 24 * 60 * 60_000;

function parseDurationMs(input: string): number | null {
  const m = DURATION_RE.exec(input.trim());
  if (!m) return null;
  const amount = Number(m[1]);
  const unit = m[2].toLowerCase();
  const multiplier = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 60 * 60_000 : 24 * 60 * 60_000;
  const ms = amount * multiplier;
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_UNLOCK_MS) return null;
  return ms;
}

function formatJakartaTime(date: Date): string {
  return `${date.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })} WIB`;
}

async function sendReply(text: string): Promise<void> {
  const { botToken, notifyChatId } = config.telegram;
  if (!botToken || !notifyChatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: notifyChatId, text }),
    });
  } catch (err) {
    logger.warn({ err }, "Gagal membalas perintah gembok lewat Telegram");
  }
}

interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; chat?: { id?: number | string } };
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const text = update.message?.text?.trim();
  const chatId = update.message?.chat?.id !== undefined ? String(update.message.chat.id) : "";
  if (!text || !chatId) return;

  if (chatId !== config.telegram.notifyChatId) {
    logger.warn({ chatId, text }, "Perintah gembok /admin-xpawto dari chat Telegram TAK DIKENAL, diabaikan");
    return;
  }

  if (text === "/lock") {
    await lockMasterNow();
    logger.info("Sakelar gembok /admin-xpawto: DIKUNCI manual lewat Telegram");
    await sendReply("🔒 /admin-xpawto dikunci kembali.");
    return;
  }

  const unlockMatch = /^\/unlock(?:@\S+)?(?:\s+(\S+))?/i.exec(text);
  if (unlockMatch) {
    const durationInput = unlockMatch[1];
    if (!durationInput) {
      await sendReply("Sertakan durasi, contoh: /unlock 5m, /unlock 2h, /unlock 3d (satuan: s/m/h/d, bebas berapa pun).");
      return;
    }
    const ms = parseDurationMs(durationInput);
    if (ms === null) {
      await sendReply("Format durasi tidak dikenali. Contoh: /unlock 5m, /unlock 45m, /unlock 2h, /unlock 3d.");
      return;
    }
    const until = await unlockMasterFor(ms);
    logger.info({ until }, "Sakelar gembok /admin-xpawto: DIBUKA lewat Telegram");
    await sendReply(`🔓 /admin-xpawto terbuka sampai ${formatJakartaTime(until)}.\nKirim /lock kapan saja untuk mengunci lebih cepat.`);
    return;
  }

  if (text === "/status") {
    const { unlocked, unlockedUntil } = await isMasterUnlocked();
    await sendReply(
      unlocked && unlockedUntil
        ? `🔓 Sedang terbuka sampai ${formatJakartaTime(unlockedUntil)}.`
        : "🔒 Sedang terkunci. Kirim /unlock <durasi> untuk membuka, contoh: /unlock 30m atau /unlock 2h"
    );
    return;
  }

  if (text === "/cekstatus") {
    await handleCekStatus();
  }
}

/** Cek koneksi Akun Kedua (satu-satunya akun yang notifikasinya lewat Telegram - lihat
 * TELEGRAM_NOTIFY_ACCOUNT_ID) tanpa perlu buka dashboard sama sekali - berguna kalau curiga
 * koneksinya putus (mis. sudah lama tidak ada notifikasi masuk sama sekali). Status live
 * (connected/isConnecting) diutamakan dari runtime in-memory, BUKAN cuma kolom `connected` di
 * database yang bisa basi sesaat setelah bot baru restart sebelum reconnect selesai - sama
 * seperti /api/inbox/extra-accounts/[id]/status di sisi web. */
async function handleCekStatus(): Promise<void> {
  const account = await prisma.extraAccount.findUnique({ where: { id: TELEGRAM_NOTIFY_ACCOUNT_ID } });
  if (!account) {
    await sendReply("Akun Kedua belum pernah disetup sama sekali.");
    return;
  }
  const runtime = getExtraAccountRuntimeStatus(TELEGRAM_NOTIFY_ACCOUNT_ID);
  const phone = account.phoneNumber ? `+${account.phoneNumber}` : "-";
  const lastConnected = account.lastConnectedAt ? formatJakartaTime(account.lastConnectedAt) : "belum pernah";

  if (runtime.connected) {
    await sendReply(`🟢 Akun Kedua (${phone}) TERHUBUNG.\nTersambung sejak: ${lastConnected}.`);
  } else if (runtime.isConnecting) {
    await sendReply(`🟡 Akun Kedua (${phone}) sedang MENYAMBUNGKAN ULANG...\nTerakhir tersambung: ${lastConnected}.`);
  } else {
    await sendReply(
      `🔴 Akun Kedua (${phone}) TERPUTUS.\nTerakhir tersambung: ${lastConnected}.\nSambungkan ulang lewat /admin-xpawto (scan QR/kode pairing).`
    );
  }
}

async function pollLoop(): Promise<void> {
  const { botToken } = config.telegram;
  while (polling) {
    try {
      // timeout=25: long-polling di sisi Telegram - permintaan ini sendiri menggantung
      // sampai ada update baru atau 25 detik berlalu, jadi TIDAK perlu jeda tambahan antar
      // iterasi (bukan busy-loop, satu permintaan HTTP yang menunggu adalah "jeda"-nya).
      const res = await fetch(
        `https://api.telegram.org/bot${botToken}/getUpdates?timeout=25&offset=${updateOffset}&allowed_updates=%5B%22message%22%5D`
      );
      if (!res.ok) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      const data = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] };
      for (const update of data.result ?? []) {
        updateOffset = update.update_id + 1;
        await handleUpdate(update).catch((err) => logger.error({ err, update }, "Gagal memproses perintah gembok Telegram"));
      }
    } catch (err) {
      logger.warn({ err }, "Polling perintah Telegram gagal, coba lagi sebentar");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

export function startTelegramCommandListener(): void {
  const { botToken, notifyChatId } = config.telegram;
  if (!botToken || !notifyChatId) {
    logger.warn(
      "TELEGRAM_BOT_TOKEN/TELEGRAM_NOTIFY_CHAT_ID belum diset - sakelar gembok /admin-xpawto TIDAK BISA dibuka lewat Telegram " +
        "(tetap terkunci permanen sampai dikonfigurasi, atau lewat jalur break-glass packages/db/scripts/setMasterLock.ts)."
    );
    return;
  }
  if (polling) return;
  polling = true;
  logger.info("Listener perintah Telegram dimulai (/unlock, /lock, /status, /cekstatus)");
  pollLoop();
}
