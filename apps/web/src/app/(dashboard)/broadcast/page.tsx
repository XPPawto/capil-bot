import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/format";
import { BroadcastForm } from "./BroadcastForm";

export default async function BroadcastPage() {
  const [recipients, history] = await Promise.all([
    prisma.request.findMany({ distinct: ["waJid"], select: { waJid: true } }),
    prisma.broadcast.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { admin: true } }),
  ]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-serif text-3xl italic tracking-tight text-ink">Broadcast Informasi</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Kirim pengumuman ke semua warga yang pernah berinteraksi dengan bot.
        </p>
      </div>

      <p className="rounded-lg bg-pastel-yellow px-4 py-3 text-sm text-pastel-yellow-ink">
        Gunakan secukupnya. Mengirim pesan massal terlalu sering berisiko membuat nomor bot ditandai
        mencurigakan oleh WhatsApp.
      </p>

      <BroadcastForm recipientCount={recipients.length} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Riwayat Broadcast</h2>
        <ul className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
          {history.map((b) => (
            <li key={b.id} className="border-b border-line pb-2 text-sm last:border-0 last:pb-0">
              <p className="whitespace-pre-wrap text-ink">{b.message}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {formatDateTime(b.createdAt)} &middot; {b.recipientCount} penerima
                {b.admin ? ` · oleh ${b.admin.name}` : ""}
              </p>
            </li>
          ))}
          {history.length === 0 && <li className="text-sm text-ink-muted">Belum pernah mengirim broadcast.</li>}
        </ul>
      </section>
    </div>
  );
}
