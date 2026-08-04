import { prisma } from "@/lib/prisma";
import { IconUsers } from "@/components/icons";

export default async function PetugasPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const contacts = await prisma.staffContact.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="font-serif text-3xl italic tracking-tight text-ink">Kontak Petugas</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Nomor WA yang otomatis dikabari bot setiap ada pengajuan baru masuk.
        </p>
      </div>

      {error && <p className="rounded-md bg-pastel-red px-3 py-2 text-sm text-pastel-red-ink">{error}</p>}

      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {contacts.map((c) => (
          <li
            key={c.id}
            className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pastel-blue text-pastel-blue-ink">
                <IconUsers className="h-4 w-4" />
              </span>
              <div>
                <p className={c.active ? "text-ink" : "text-ink-muted line-through"}>{c.label}</p>
                <p className="text-xs text-ink-muted">{c.waNumber}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <form action={`/api/staff-contacts/${c.id}`} method="POST">
                <input type="hidden" name="action" value="toggle" />
                <button
                  type="submit"
                  className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-hover"
                >
                  {c.active ? "Nonaktifkan" : "Aktifkan"}
                </button>
              </form>
              <form action={`/api/staff-contacts/${c.id}`} method="POST">
                <input type="hidden" name="action" value="delete" />
                <button
                  type="submit"
                  className="rounded-md border border-pastel-red-ink/30 px-2.5 py-1 text-xs text-pastel-red-ink transition-colors hover:bg-pastel-red"
                >
                  Hapus
                </button>
              </form>
            </div>
          </li>
        ))}
        {contacts.length === 0 && <li className="px-4 py-3 text-sm text-ink-muted">Belum ada kontak petugas.</li>}
      </ul>

      <form
        action="/api/staff-contacts"
        method="POST"
        className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-muted">Nomor WA (contoh: 6281234567890)</label>
          <input
            name="waNumber"
            required
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-muted">Label</label>
          <input
            name="label"
            required
            placeholder="Contoh: Petugas Loket 1"
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink"
          />
        </div>
        <button
          type="submit"
          className="w-fit rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-canvas transition-colors hover:opacity-90"
        >
          Tambah Kontak
        </button>
      </form>
    </div>
  );
}
