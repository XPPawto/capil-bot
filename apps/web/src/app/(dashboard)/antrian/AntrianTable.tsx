"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { RequestStatus, ServiceType } from "@kelurahan/db";
import {
  priorityBadgeClass,
  priorityLabel,
  relativeDuration,
  serviceLabel,
  servicePriorityWeight,
  statusBadgeClass,
  statusLabel,
} from "@/lib/format";

export interface AntrianRow {
  id: string;
  ticketNumber: string;
  applicantName: string;
  serviceType: ServiceType;
  waNumber: string;
  createdAt: string;
  status: RequestStatus;
  readyForPickupSentAt: string | null;
}

const FILTERS: { key: "ALL" | "DICEK" | "DIPROSES"; label: string }[] = [
  { key: "ALL", label: "Semua" },
  { key: "DICEK", label: "Dicek" },
  { key: "DIPROSES", label: "Diproses" },
];

export function AntrianTable({ rows }: { rows: AntrianRow[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get("status");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "DICEK" | "DIPROSES">(
    initialStatus === "DICEK" || initialStatus === "DIPROSES" ? initialStatus : "ALL"
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.applicantName.toLowerCase().includes(q) ||
        r.ticketNumber.toLowerCase().includes(q) ||
        r.waNumber.includes(q)
      );
    });
  }, [rows, query, statusFilter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari nama, nomor tiket, atau nomor WA..."
          className="w-full max-w-xs rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink sm:w-72"
        />
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === f.key
                  ? "bg-ink text-canvas"
                  : "border border-line text-ink-muted hover:bg-surface-hover"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-ink-muted">
          {filtered.length} dari {rows.length} pengajuan
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="min-w-full divide-y divide-line text-sm">
          <thead className="bg-canvas text-left text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">No. Tiket</th>
              <th className="px-4 py-3 font-medium">Pemohon</th>
              <th className="px-4 py-3 font-medium">Layanan</th>
              <th className="hidden px-4 py-3 font-medium sm:table-cell">Nomor WA</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Menunggu</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((r) => (
              <tr
                key={r.id}
                onClick={() => router.push(`/antrian/${r.id}`)}
                className="cursor-pointer transition-colors hover:bg-surface-hover"
              >
                <td className="px-4 py-3 font-mono text-xs text-ink">{r.ticketNumber}</td>
                <td className="px-4 py-3 text-ink">{r.applicantName}</td>
                <td className="px-4 py-3 text-ink-muted">
                  <div className="flex items-center gap-1.5">
                    {serviceLabel(r.serviceType)}
                    {servicePriorityWeight(r.serviceType) > 1 && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${priorityBadgeClass(
                          servicePriorityWeight(r.serviceType)
                        )}`}
                      >
                        {priorityLabel(servicePriorityWeight(r.serviceType))}
                      </span>
                    )}
                  </div>
                </td>
                <td className="hidden px-4 py-3 text-ink-muted sm:table-cell">{r.waNumber}</td>
                <td className="hidden px-4 py-3 text-ink-muted md:table-cell">{relativeDuration(r.createdAt)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(r.status)}`}>
                    {statusLabel(r.status)}
                  </span>
                  {r.status === "DIPROSES" && (
                    <span className="ml-1.5 text-[11px] text-ink-muted">
                      {r.readyForPickupSentAt ? "siap diambil" : "belum siap"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-ink-muted">
                  {rows.length === 0 ? "Tidak ada antrian saat ini." : "Tidak ada pengajuan yang cocok."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
