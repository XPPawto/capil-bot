# Bot WA Layanan Administrasi Kelurahan

Bot WhatsApp (Baileys) untuk pengajuan Kartu Keluarga, Akte Kematian, dan Akte Kelahiran, lengkap dengan
dashboard admin (Next.js) untuk memproses antrian, memvalidasi pengambilan dokumen lewat QR, dan mengelola
koneksi nomor WA bot.

## Struktur Proyek

```
packages/db      Prisma schema + client (dipakai bersama oleh bot & web)
apps/bot         Proses Baileys (bot WA) + control server internal
apps/web         Dashboard admin (Next.js)
storage/         Berkas syarat warga (di-gitignore, berisi data pribadi)
ecosystem.config.js   Konfigurasi PM2 untuk menjalankan bot + web di production
```

## Prasyarat

- Node.js 20+
- Docker (untuk MySQL lokal) — atau gunakan MySQL/MariaDB yang sudah ada
- Nomor WhatsApp khusus untuk bot (bukan nomor pribadi petugas)

## Setup Awal

```bash
npm install
cp .env.example .env
```

Sesuaikan `.env` bila perlu, terutama `BOT_CONTROL_SECRET` (ganti dengan string acak) dan port MySQL kalau
port 3316 di `docker-compose.yml` bentrok dengan service lain di mesin Anda.

Jalankan database:

```bash
npm run db:up        # start MySQL via docker compose
npm run db:migrate   # buat schema
npm run db:seed      # admin default + syarat default 3 layanan
```

Login default dashboard: **username `admin`, password `admin123`** — segera ganti lewat menu **Akun**
setelah login pertama.

`docker-compose.yml` juga menyediakan dua tool untuk lihat isi database langsung lewat browser (opsional,
tinggal pilih salah satu):
- **phpMyAdmin** — http://localhost:8092 (server: `db`, user/password sesuai `.env`)
- **Adminer** (lebih ringan) — http://localhost:8091

## Menjalankan (development)

```bash
npm run dev
```

Menjalankan bot dan dashboard sekaligus:
- Dashboard: http://localhost:8450 (port bisa diubah lewat `-p` di `apps/web/package.json`)
- Control server bot (internal, jangan diekspos publik): http://127.0.0.1:4001

Pertama kali dijalankan, bot belum tertaut ke WhatsApp. Tautkan lewat salah satu cara:
- Terminal: scan QR yang tercetak di log `[bot]`.
- Dashboard: buka menu **Koneksi Bot** (`/bot`), pilih tab **QR Code** atau **Kode Pairing**.

---

## Arsitektur & Cara Kerja

### Gambaran umum

Tiga bagian berjalan sebagai **proses terpisah** tapi berbagi **satu database MySQL** sebagai meja
perantara — bot menulis data, dashboard membaca/mengubahnya. Selain lewat DB, keduanya juga bicara langsung
lewat satu jalur HTTP internal kecil (lihat bagian "Komunikasi Bot ↔ Dashboard").

### Model data inti (`packages/db/prisma/schema.prisma`)

| Model | Fungsi |
|---|---|
| `Admin` / `Session` | Akun & sesi login dashboard (sesi disimpan di DB, bukan JWT — logout = hapus baris, langsung invalid) |
| `BotSession` | Baris tunggal berisi status koneksi WA bot saat ini |
| `ConversationState` | State percakapan warga **selama masih mengisi formulir**, belum jadi pengajuan resmi |
| `RequirementTemplate` | Daftar syarat dokumen per layanan, bisa diedit admin tanpa ubah kode |
| `Request` | Pengajuan yang **sudah lengkap** — inilah yang muncul di dashboard |
| `RequestDocument` | Berkas per syarat, terhubung ke `Request` |
| `StatusHistory` | Jejak audit tiap perubahan status |
| `TicketSequence` | Penghitung atomik nomor tiket per layanan+bulan |
| `StaffContact` | Nomor WA petugas yang dikabari otomatis saat ada pengajuan baru |

`ConversationState` sengaja dipisah dari `Request` supaya antrian admin tidak kotor oleh warga yang baru
setengah upload syarat — baris `Request` baru dibuat setelah **semua** syarat lengkap.

### Bot WhatsApp (`apps/bot`)

**Koneksi.** `src/wa/socket.ts` memakai Baileys untuk terhubung ke WhatsApp lewat QR code atau kode pairing.
Sesi login disimpan di `apps/bot/.baileys_auth/` sehingga restart proses tidak perlu scan ulang. Kalau
koneksi terputus, bot otomatis reconnect dengan jeda meningkat — kecuali penyebabnya "logged out" (di-unlink
dari HP), yang mengharuskan link ulang manual dari dashboard.

**Alur percakapan (state machine).** Tiap pesan masuk diproses `src/conversation/messageHandler.ts` →
`handler.ts`:

```
IDLE ──(pilih 1/2/3)──▶ AWAIT_NAME ──(ketik nama)──▶ COLLECTING_DOCS ──(syarat lengkap)──▶ kembali ke IDLE
```

State disimpan di tabel `ConversationState` (bukan cuma di memori), jadi tahan terhadap restart bot di
tengah proses. Command global yang aktif dari state manapun: `menu` (reset), `batal` (batalkan), `status`
(cek semua pengajuan tanpa mengganggu proses yang sedang berjalan).

**Upload berkas.** Tiap foto/PDF divalidasi (tipe & ukuran maks 10MB), diunduh ke `storage/tmp/`. Dokumen
yang dikirim WhatsApp sebagai "Dokumen" sering dibungkus `documentWithCaptionMessage` — kode ini membuka
bungkus tersebut dulu (`extractMessageContent`) sebelum memeriksa tipe medianya, supaya PDF tidak salah
dianggap "tidak didukung". Setelah semua syarat lengkap, berkas dipindah ke `storage/uploads/<idPengajuan>/`
dan baris `Request` dibuat sekaligus generate **nomor tiket** (`KK-2608-0001`) lewat atomic increment MySQL
(`INSERT ... ON DUPLICATE KEY UPDATE ... LAST_INSERT_ID`) yang aman dari tabrakan nomor.

**Proteksi race condition.** Kalau warga kirim beberapa foto sekaligus dari galeri, WhatsApp bisa memicu
beberapa event hampir bersamaan. `src/conversation/mutex.ts` mengantrekan pemrosesan per nomor WA (promise
chain), sehingga tidak ada dua pesan dari orang yang sama diproses paralel dan saling menimpa
`ConversationState`.

**Notifikasi keluar:**
- Status → **Diproses**: bot kirim gambar QR pengambilan ke warga.
- Admin klik **"Kirim Notifikasi Siap Diambil"**: notifikasi terpisah, dikirim manual saat dokumen fisik
  benar-benar sudah jadi (bisa dikirim ulang).
- Status → **Ditolak** / **Selesai**: pesan sesuai.
- Ada pengajuan baru masuk: broadcast ke semua nomor di `StaffContact` yang aktif.
- Job berjalan tiap jam (`src/jobs/remindPendingPickup.ts`) mengecek dokumen "siap diambil" yang sudah 3
  hari belum diambil, kirim reminder sekali (ditandai `pickupReminderSentAt` supaya tidak berulang).
- Semua pengiriman notifikasi status tercatat di `notifiedStatus`/`notifiedAt`; kalau gagal terkirim (bot
  sempat mati), **reconciler** (`src/notify/reconciler.ts`) polling tiap 25 detik dan mengirim ulang yang
  tertinggal — jadi kegagalan sementara tidak membuat notifikasi hilang.

### Dashboard Admin (`apps/web`, Next.js App Router)

| Halaman | Fungsi |
|---|---|
| `/` | Ringkasan jumlah pengajuan per status + status live koneksi bot |
| `/antrian` | Daftar pengajuan aktif (Dicek/Diproses) |
| `/antrian/[id]` | Detail — pratinjau berkas langsung (foto inline, PDF ter-embed), ubah status |
| `/riwayat` | Pengajuan Selesai/Ditolak — bisa cari (nama/nomor/tiket), filter, dan **dihapus** (berkas fisik ikut terhapus) |
| `/scan` | Scan QR pakai kamera untuk validasi pengambilan — begitu valid, otomatis langsung ditandai **Selesai** |
| `/bot` | Kelola koneksi WA (connect via QR/kode pairing, logout) |
| `/syarat` | Atur daftar syarat dokumen per layanan |
| `/petugas` | Atur nomor WA yang dikabari otomatis saat ada pengajuan baru |
| `/akun` | Ganti password admin |

**Sesi login**: token acak di-hash lalu disimpan di tabel `Session`. `middleware.ts` mengecek keberadaan
cookie (cepat, jalan di Edge), sedangkan validitas sesungguhnya (cek DB + kedaluwarsa) divalidasi tiap
halaman/API lewat `getCurrentAdmin()`.

**Transaksi perubahan status**: tiap perubahan status dicek dulu terhadap status saat ini sebelum ditulis
(`updateMany` dengan syarat status lama sebagai bagian WHERE) — mencegah dua petugas mengubah status
bersamaan menghasilkan hasil yang tidak konsisten (yang kedua akan gagal dengan pesan "sudah berubah, muat
ulang").

### Komunikasi Bot ↔ Dashboard

Bot menjalankan HTTP server kecil (`src/server/controlServer.ts`) yang **hanya bisa diakses dari mesin yang
sama** (`127.0.0.1:4001`, dilindungi header secret). Dashboard adalah satu-satunya klien — browser tidak
pernah bicara langsung ke bot.

```
Browser ──▶ Dashboard (sesi admin) ──▶ Control Server Bot (secret internal) ──▶ WhatsApp
```

Saat admin mengubah status: dashboard update DB lebih dulu, baru memanggil control server untuk mengirim
notifikasi WA. Kalau panggilan itu gagal (bot sedang down), tidak masalah — reconciler di bot akan
menyusulkan pengiriman begitu bot hidup kembali.

### Alur end-to-end

```
1. Warga chat bot → pilih layanan → isi nama → upload semua syarat
2. Bot: "Semua lengkap, nomor tiket Anda KK-2608-0001, sedang dicek"
   └─ Request dibuat (status DICEK), notifikasi dikirim ke semua StaffContact aktif

3. Petugas buka dashboard → Antrian → buka detail
   → lihat pratinjau semua berkas langsung di halaman → klik "Proses"
   └─ Status → DIPROSES, bot kirim QR ke warga

4. (dokumen fisik selesai dicetak) Petugas klik "Kirim Notifikasi Siap Diambil"
   └─ Bot kirim WA: "dokumen sudah siap diambil"

5. Warga datang, tunjukkan QR. Petugas buka /scan, arahkan kamera
   └─ QR valid → otomatis langsung SELESAI (tanpa konfirmasi manual)

6. Ditolak di langkah manapun → bot kirim alasan, warga mengajukan ulang dari awal
```

Warga bisa ketik `status` kapan saja untuk cek sendiri tanpa menunggu notifikasi.

---

## Build Produksi

```bash
npm run build
```

Dijalankan lewat **PM2** memakai `ecosystem.config.js` di root (menjalankan `npm run start` di masing-masing
workspace, yang sudah membungkus `NODE_ENV=production` dan load `.env` lewat `dotenv-cli`):

```bash
npx pm2 start ecosystem.config.js
npx pm2 save        # supaya tetap hidup setelah reboot (perlu setup pm2 startup terpisah)
```

Perintah PM2 yang sering dipakai: `npx pm2 status`, `npx pm2 logs kelurahan-bot`, `npx pm2 restart kelurahan-bot`.

Pastikan folder `apps/bot/.baileys_auth/` dan `storage/` ikut di-backup/persist saat deploy — jika hilang,
sesi WA & seluruh berkas syarat warga ikut hilang.

Untuk expose dashboard ke domain publik, tinggal arahkan reverse proxy (nginx, atau Cloudflare Tunnel) ke
port dashboard (default 8450) — tidak perlu setup tambahan di sisi aplikasi. **Jangan pernah** expose port
control server bot (4001) ke publik.

## Keamanan & Keterbatasan

- Baileys adalah client WhatsApp tidak resmi. Gunakan nomor khusus (bukan nomor pribadi), hindari kirim pesan
  massal, dan terima kemungkinan kecil nomor dibatasi WhatsApp jika pola pemakaian dianggap mencurigakan.
  Sesi enkripsi WhatsApp (Signal protocol) kadang bisa "nyasar" dan menyebabkan pesan masuk gagal dibaca bot
  ("Bad MAC"/session error di log) — biasanya self-heal sendiri, kalau tidak, restart proses bot (`pm2
  restart kelurahan-bot`) cukup tanpa perlu scan ulang QR.
- Berkas syarat warga (KTP, akte, dll.) hanya bisa diakses lewat dashboard yang sudah login — tidak pernah
  lewat folder publik.
- Jangan pernah commit `.env`, folder `apps/bot/.baileys_auth/`, atau isi `storage/` — semuanya sudah
  di-gitignore secara default.
