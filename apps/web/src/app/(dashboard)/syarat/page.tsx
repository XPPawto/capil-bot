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
        <h1 className="font-serif text-3xl italic tracking-tight text-ink">Syarat Layanan</h1>
        <p className="mt-1 text-sm text-ink-muted">Daftar dokumen yang diminta bot ke warga untuk tiap layanan.</p>
      </div>

      {error && <p className="rounded-md bg-pastel-red px-3 py-2 text-sm text-pastel-red-ink">{error}</p>}

      {SERVICE_TYPES.map((serviceType) => {
        const items = requirements.filter((r) => r.serviceType === serviceType);
        return (
          <section key={serviceType} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-ink">{serviceLabel(serviceType)}</h2>
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {items.map((item, idx) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className={item.active ? "text-ink" : "text-ink-muted line-through"}>
                    {idx + 1}. {item.name}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <form action={`/api/requirements/${item.id}`} method="POST">
                      <input type="hidden" name="action" value="move" />
                      <input type="hidden" name="direction" value="up" />
                      <button
                        type="submit"
                        disabled={idx === 0}
                        aria-label="Naikkan urutan"
                        className="rounded-md border border-line px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-hover disabled:opacity-30"
                      >
                        &uarr;
                      </button>
                    </form>
                    <form action={`/api/requirements/${item.id}`} method="POST">
                      <input type="hidden" name="action" value="move" />
                      <input type="hidden" name="direction" value="down" />
                      <button
                        type="submit"
                        disabled={idx === items.length - 1}
                        aria-label="Turunkan urutan"
                        className="rounded-md border border-line px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-hover disabled:opacity-30"
                      >
                        &darr;
                      </button>
                    </form>
                    <form action={`/api/requirements/${item.id}`} method="POST">
                      <input type="hidden" name="action" value="toggle" />
                      <button
                        type="submit"
                        className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-hover"
                      >
                        {item.active ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                    </form>
                    <form action={`/api/requirements/${item.id}`} method="POST">
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
              {items.length === 0 && (
                <li className="px-4 py-3 text-sm text-ink-muted">Belum ada syarat untuk layanan ini.</li>
              )}
            </ul>
            <form action="/api/requirements" method="POST" className="flex gap-2">
              <input type="hidden" name="serviceType" value={serviceType} />
              <input
                name="name"
                placeholder="Nama syarat baru"
                required
                className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink"
              />
              <button
                type="submit"
                className="rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#333333]"
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
