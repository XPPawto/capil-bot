"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { NewRequestWatcher } from "./NewRequestWatcher";
import {
  IconBot,
  IconClose,
  IconDocument,
  IconGrid,
  IconHistory,
  IconLogout,
  IconMegaphone,
  IconMenu,
  IconQueue,
  IconScan,
  IconShield,
  IconStar,
  IconUserCircle,
  IconUsers,
} from "@/components/icons";

const NAV_ITEMS = [
  { href: "/", label: "Ringkasan", icon: IconGrid },
  { href: "/antrian", label: "Antrian", icon: IconQueue },
  { href: "/riwayat", label: "Riwayat", icon: IconHistory },
  { href: "/scan", label: "Scan QR", icon: IconScan },
  { href: "/bot", label: "Koneksi Bot", icon: IconBot },
  { href: "/syarat", label: "Syarat Layanan", icon: IconDocument },
  { href: "/petugas", label: "Kontak Petugas", icon: IconUsers },
  { href: "/broadcast", label: "Broadcast", icon: IconMegaphone },
  { href: "/kepuasan", label: "Indeks Kepuasan", icon: IconStar },
  { href: "/keamanan", label: "Keamanan", icon: IconShield },
  { href: "/akun", label: "Akun", icon: IconUserCircle },
];

export function DashboardShell({ adminName, children }: { adminName: string; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const currentLabel = NAV_ITEMS.find((item) => item.href === pathname)?.label ?? "Kelurahan Digital";

  // Tutup sidebar otomatis tiap kali pindah halaman (penting untuk mobile).
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <NewRequestWatcher />
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Buka menu"
          className="-ml-2 rounded-md p-2 text-ink hover:bg-surface-hover"
        >
          <IconMenu />
        </button>
        <p className="text-sm font-medium text-ink">{currentLabel}</p>
        <div className="w-9" />
      </header>

      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-black/20 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 -translate-x-full flex-col border-r border-line bg-surface px-3 py-5 transition-transform duration-200 ease-in-out md:sticky md:top-0 md:h-screen md:w-60 md:translate-x-0 ${
          isOpen ? "translate-x-0" : ""
        }`}
      >
        <div className="mb-6 flex items-center justify-between px-1">
          <div className="flex items-center gap-2.5">
            <Logo size={34} />
            <div>
              <p className="text-sm font-semibold text-ink">Kelurahan Digital</p>
              <p className="text-[11px] text-ink-muted">Dashboard Admin</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Tutup menu"
            className="rounded-md p-1 text-ink-muted hover:bg-surface-hover md:hidden"
          >
            <IconClose />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-pastel-blue font-medium text-pastel-blue-ink"
                    : "text-ink-muted hover:bg-surface-hover hover:text-ink"
                }`}
              >
                <Icon />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line pt-3">
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pastel-blue text-xs font-semibold text-pastel-blue-ink">
              {adminName.slice(0, 1).toUpperCase()}
            </span>
            <p className="truncate text-xs text-ink-muted">{adminName}</p>
          </div>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
            >
              <IconLogout />
              Logout
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-canvas px-4 py-6 md:px-10 md:py-9">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
