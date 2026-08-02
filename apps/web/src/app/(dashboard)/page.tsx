import Link from "next/link";
import { getBotStatus } from "@/lib/botClient";
import { prisma } from "@/lib/prisma";
import { IconBot, IconHistory, IconQueue, IconScan, IconUsers } from "@/components/icons";

export default async function OverviewPage() {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [dicek, diproses, ditolak, selesai, thisMonth, botStatus] = await Promise.all([
    prisma.request.count({ where: { status: "DICEK" } }),
    prisma.request.count({ where: { status: "DIPROSES" } }),
    prisma.request.count({ where: { status: "DITOLAK" } }),
    prisma.request.count({ where: { status: "SELESAI" } }),
    prisma.request.count({ where: { createdAt: { gte: startOfMonth } } }),
    // Status koneksi diambil langsung dari proses bot (bukan kolom BotSession di DB),
    // supaya tidak menampilkan "Terhubung" basi kalau proses bot mati mendadak
    // (mis. OOM/crash) sebelum sempat menandai dirinya disconnected di DB.
    getBotStatus().catch(() => null),
  ]);

  const cards = [
    { label: "Menunggu Dicek", value: dicek, href: "/antrian?status=DICEK", tone: "yellow" as const },
    { label: "Diproses", value: diproses, href: "/antrian?status=DIPROSES", tone: "blue" as const },
    { label: "Ditolak", value: ditolak, href: "/riwayat?status=DITOLAK", tone: "red" as const },
    { label: "Selesai", value: selesai, href: "/riwayat?status=SELESAI", tone: "green" as const },
  ];

  const toneClass: Record<string, string> = {
    yellow: "bg-pastel-yellow text-pastel-yellow-ink",
    blue: "bg-pastel-blue text-pastel-blue-ink",
    red: "bg-pastel-red text-pastel-red-ink",
    green: "bg-pastel-green text-pastel-green-ink",
  };

  const connected = botStatus?.connected === true;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-serif text-3xl italic tracking-tight text-ink">Ringkasan</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Status pengajuan layanan administrasi kelurahan &middot; {thisMonth} pengajuan bulan ini
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="group rounded-xl border border-line bg-surface p-5 transition-colors hover:border-ink/20"
          >
            <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${toneClass[c.tone]}`}>
              {c.label}
            </span>
            <p className="mt-3 font-serif text-4xl text-ink">{c.value}</p>
            <p className="mt-1 text-xs text-ink-muted transition-colors group-hover:text-ink">Lihat daftar &rarr;</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/bot"
          className="flex items-center justify-between rounded-xl border border-line bg-surface p-5 transition-colors hover:border-ink/20"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-pastel-blue text-pastel-blue-ink">
              <IconBot />
            </span>
            <div>
              <p className="text-sm font-medium text-ink">Status Bot WhatsApp</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-pastel-green-ink" : "bg-pastel-red-ink"}`} />
                {botStatus === null
                  ? "Proses bot tidak dapat dihubungi"
                  : connected
                    ? `Terhubung${botStatus.phoneNumber ? ` (${botStatus.phoneNumber})` : ""}`
                    : "Belum terhubung"}
              </p>
            </div>
          </div>
        </Link>

        <div className="rounded-xl border border-line bg-surface p-5">
          <p className="mb-3 text-sm font-medium text-ink">Aksi Cepat</p>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/scan"
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-hover"
            >
              <IconScan className="h-3.5 w-3.5" />
              Scan QR
            </Link>
            <Link
              href="/riwayat"
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-hover"
            >
              <IconHistory className="h-3.5 w-3.5" />
              Riwayat
            </Link>
            <Link
              href="/petugas"
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-hover"
            >
              <IconUsers className="h-3.5 w-3.5" />
              Kontak Petugas
            </Link>
            <Link
              href="/antrian"
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-hover"
            >
              <IconQueue className="h-3.5 w-3.5" />
              Antrian
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
