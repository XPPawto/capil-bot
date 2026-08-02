"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_MS = 15000;

/**
 * Me-refresh data server (status, riwayat status, daftar dokumen) secara berkala tanpa
 * interaksi petugas, supaya perubahan dari proses lain (bot, admin lain di tab berbeda)
 * ikut kelihatan tanpa perlu reload manual. router.refresh() hanya menarik ulang data
 * komponen server - state komponen client (mis. draft chat yang sedang diketik) tidak ikut hilang.
 */
export function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(interval);
  }, [router]);

  return null;
}
