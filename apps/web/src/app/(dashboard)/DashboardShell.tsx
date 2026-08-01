"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";

const NAV_ITEMS = [
  { href: "/", label: "Ringkasan" },
  { href: "/antrian", label: "Antrian" },
  { href: "/riwayat", label: "Riwayat" },
  { href: "/scan", label: "Scan QR" },
  { href: "/bot", label: "Koneksi Bot" },
  { href: "/syarat", label: "Syarat Layanan" },
  { href: "/petugas", label: "Kontak Petugas" },
  { href: "/akun", label: "Akun" },
];

export function DashboardShell({ adminName, children }: { adminName: string; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  // Tutup sidebar otomatis tiap kali pindah halaman (penting untuk mobile).
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Buka menu"
          className="rounded-md p-2 text-neutral-700 hover:bg-neutral-100"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="flex items-center gap-2">
          <Logo size={28} />
          <p className="text-sm font-semibold text-neutral-900">Kelurahan Digital</p>
        </span>
        <div className="w-9" />
      </header>

      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 -translate-x-full flex-col border-r border-neutral-200 bg-neutral-50 px-4 py-6 transition-transform duration-200 ease-in-out md:static md:z-auto md:w-60 md:translate-x-0 ${
          isOpen ? "translate-x-0" : ""
        }`}
      >
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Logo size={36} />
            <div>
              <p className="text-sm font-semibold text-neutral-900">Kelurahan Digital</p>
              <p className="text-xs text-neutral-500">Dashboard Admin</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Tutup menu"
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-200 md:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm hover:bg-neutral-200 ${
                pathname === item.href ? "bg-neutral-200 font-medium text-neutral-900" : "text-neutral-700"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-neutral-200 pt-4">
          <p className="mb-2 truncate text-xs text-neutral-500">Masuk sebagai {adminName}</p>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Logout
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-white px-4 py-5 md:px-8 md:py-6">{children}</main>
    </div>
  );
}
