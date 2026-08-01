import type { ServiceType } from "@kelurahan/db";
import { serviceLabel } from "@/lib/format";
import { prisma } from "@/lib/prisma";

const SERVICE_TYPES: ServiceType[] = ["KARTU_KELUARGA", "AKTE_KEMATIAN", "AKTE_KELAHIRAN"];

export default async function SyaratPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const requirements = await prisma.requirementTemplate.findMany({
    orderBy: [{ serviceType: "asc" }, { order: "asc" }],
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Syarat Layanan</h1>
        <p className="text-sm text-neutral-500">Daftar dokumen yang diminta bot ke warga untuk tiap layanan.</p>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {SERVICE_TYPES.map((serviceType) => {
        const items = requirements.filter((r) => r.serviceType === serviceType);
        return (
          <section key={serviceType} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-neutral-900">{serviceLabel(serviceType)}</h2>
            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
              {items.map((item, idx) => (
                <li key={item.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className={item.active ? "text-neutral-900" : "text-neutral-400 line-through"}>
                    {item.name}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={`/api/requirements/${item.id}`} method="POST">
                      <input type="hidden" name="action" value="move" />
                      <input type="hidden" name="direction" value="up" />
                      <button
                        type="submit"
                        disabled={idx === 0}
                        className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-30"
                      >
                        Naik
                      </button>
                    </form>
                    <form action={`/api/requirements/${item.id}`} method="POST">
                      <input type="hidden" name="action" value="move" />
                      <input type="hidden" name="direction" value="down" />
                      <button
                        type="submit"
                        disabled={idx === items.length - 1}
                        className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-30"
                      >
                        Turun
                      </button>
                    </form>
                    <form action={`/api/requirements/${item.id}`} method="POST">
                      <input type="hidden" name="action" value="toggle" />
                      <button type="submit" className="rounded border border-neutral-300 px-2 py-1 text-xs">
                        {item.active ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                    </form>
                    <form action={`/api/requirements/${item.id}`} method="POST">
                      <input type="hidden" name="action" value="delete" />
                      <button type="submit" className="rounded border border-red-300 px-2 py-1 text-xs text-red-700">
                        Hapus
                      </button>
                    </form>
                  </div>
                </li>
              ))}
              {items.length === 0 && (
                <li className="px-4 py-2 text-sm text-neutral-400">Belum ada syarat untuk layanan ini.</li>
              )}
            </ul>
            <form action="/api/requirements" method="POST" className="flex gap-2">
              <input type="hidden" name="serviceType" value={serviceType} />
              <input
                name="name"
                placeholder="Nama syarat baru"
                required
                className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
              >
                Tambah
              </button>
            </form>
          </section>
        );
      })}
    </div>
  );
}
