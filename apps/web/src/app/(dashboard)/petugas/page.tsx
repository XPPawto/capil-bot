import { prisma } from "@/lib/prisma";

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
        <h1 className="text-xl font-semibold text-neutral-900">Kontak Petugas</h1>
        <p className="text-sm text-neutral-500">
          Nomor WA yang otomatis dikabari bot setiap ada pengajuan baru masuk.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
        {contacts.map((c) => (
          <li key={c.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className={c.active ? "text-neutral-900" : "text-neutral-400 line-through"}>{c.label}</p>
              <p className="text-xs text-neutral-500">{c.waNumber}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <form action={`/api/staff-contacts/${c.id}`} method="POST">
                <input type="hidden" name="action" value="toggle" />
                <button type="submit" className="rounded border border-neutral-300 px-2 py-1 text-xs">
                  {c.active ? "Nonaktifkan" : "Aktifkan"}
                </button>
              </form>
              <form action={`/api/staff-contacts/${c.id}`} method="POST">
                <input type="hidden" name="action" value="delete" />
                <button type="submit" className="rounded border border-red-300 px-2 py-1 text-xs text-red-700">
                  Hapus
                </button>
              </form>
            </div>
          </li>
        ))}
        {contacts.length === 0 && (
          <li className="px-4 py-3 text-sm text-neutral-400">Belum ada kontak petugas.</li>
        )}
      </ul>

      <form action="/api/staff-contacts" method="POST" className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-600">Nomor WA (contoh: 6281234567890)</label>
          <input
            name="waNumber"
            required
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-600">Label</label>
          <input
            name="label"
            required
            placeholder="Contoh: Petugas Loket 1"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          className="w-fit rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Tambah Kontak
        </button>
      </form>
    </div>
  );
}
