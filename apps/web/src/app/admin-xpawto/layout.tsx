import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/session";

// SENGAJA di luar grup route (dashboard) - halaman ini full-screen, tidak boleh terbungkus
// sidebar/topbar DashboardShell. Gerbang sesi admin (getCurrentAdmin, tervalidasi ke DB,
// bukan cuma cek cookie ada/tidak seperti middleware) diulang persis di sini supaya standar
// keamanannya tetap sama dengan halaman dashboard lain, meski layout-nya beda total. Gerbang
// PIN+TOTP tambahan ada di page.tsx (lib/accessControl.ts).
export default async function AdminXpawtoLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/login");

  return <>{children}</>;
}
