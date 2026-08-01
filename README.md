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

## Menjalankan (development)

```bash
npm run dev
```

Menjalankan bot dan dashboard sekaligus:
- Dashboard: http://localhost:3000
- Control server bot (internal, jangan diekspos publik): http://127.0.0.1:4001

Pertama kali dijalankan, bot belum tertaut ke WhatsApp. Tautkan lewat salah satu cara:
- Terminal: scan QR yang tercetak di log `[bot]`.
- Dashboard: buka menu **Koneksi Bot** (`/bot`), pilih tab **QR Code** atau **Kode Pairing**.

## Alur Penggunaan

1. Warga chat ke nomor bot → pilih salah satu dari 3 layanan → isi nama → upload semua syarat (foto/PDF).
2. Setelah lengkap, bot membalas bahwa data sedang **dicek**, dan pengajuan muncul di menu **Antrian**.
3. Petugas membuka detail pengajuan, memeriksa berkas, lalu klik **Proses** atau **Tolak** (wajib isi alasan).
4. Saat diproses, bot otomatis mengirim **QR code** ke warga untuk pengambilan dokumen di kantor.
5. Saat warga datang, petugas membuka menu **Scan QR**, arahkan kamera ke QR warga — sistem memvalidasi dan
   menampilkan status **valid/tidak valid**, lalu petugas mengklik **Konfirmasi Pengambilan** untuk menandai
   pengajuan **Selesai**.
6. Riwayat semua pengajuan yang sudah **Ditolak**/**Selesai** ada di menu **Riwayat**.
7. Daftar syarat per layanan bisa diubah admin lewat menu **Syarat Layanan** tanpa perlu mengubah kode.

## Build Produksi

```bash
npm run build
NODE_ENV=production npm run start -w apps/bot
NODE_ENV=production npm run start -w apps/web
```

Gunakan process manager (pm2/systemd/docker) untuk menjaga kedua proses tetap hidup dan otomatis restart.
Pastikan folder `apps/bot/.baileys_auth/` dan `storage/` ikut di-backup/persist saat deploy — jika hilang,
sesi WA & seluruh berkas syarat warga ikut hilang.

## Keamanan & Keterbatasan

- Baileys adalah client WhatsApp tidak resmi. Gunakan nomor khusus (bukan nomor pribadi), hindari kirim pesan
  massal, dan terima kemungkinan kecil nomor dibatasi WhatsApp jika pola pemakaian dianggap mencurigakan.
- Berkas syarat warga (KTP, akte, dll.) hanya bisa diakses lewat dashboard yang sudah login — tidak pernah
  lewat folder publik.
- Jangan pernah commit `.env`, folder `apps/bot/.baileys_auth/`, atau isi `storage/` — semuanya sudah
  di-gitignore secara default.
