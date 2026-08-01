import { getBotStatus } from "@/lib/botClient";
import { prisma } from "@/lib/prisma";

export default async function OverviewPage() {
  const [dicek, diproses, ditolak, selesai, botStatus] = await Promise.all([
    prisma.request.count({ where: { status: "DICEK" } }),
    prisma.request.count({ where: { status: "DIPROSES" } }),
    prisma.request.count({ where: { status: "DITOLAK" } }),
    prisma.request.count({ where: { status: "SELESAI" } }),
    // Status koneksi diambil langsung dari proses bot (bukan kolom BotSession di DB),
    // supaya tidak menampilkan "Terhubung" basi kalau proses bot mati mendadak
    // (mis. OOM/crash) sebelum sempat menandai dirinya disconnected di DB.
    getBotStatus().catch(() => null),
  ]);

  const cards = [
    { label: "Menunggu Dicek", value: dicek },
    { label: "Diproses", value: diproses },
    { label: "Ditolak", value: ditolak },
    { label: "Selesai", value: selesai },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Ringkasan</h1>
        <p className="text-sm text-neutral-500">Status pengajuan layanan administrasi kelurahan.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-neutral-200 p-4">
            <p className="text-2xl font-semibold text-neutral-900">{c.value}</p>
            <p className="text-sm text-neutral-500">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-neutral-200 p-4">
        <p className="text-sm font-medium text-neutral-900">Status Bot WhatsApp</p>
        <p className="mt-1 text-sm text-neutral-600">
          {botStatus === null
            ? "Proses bot tidak berjalan atau tidak dapat dihubungi."
            : botStatus.connected
              ? `Terhubung${botStatus.phoneNumber ? ` (${botStatus.phoneNumber})` : ""}`
              : "Belum terhubung"}
        </p>
      </div>
    </div>
  );
}
