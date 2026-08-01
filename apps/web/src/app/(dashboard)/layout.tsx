import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/session";
import { DashboardShell } from "./DashboardShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/login");

  return <DashboardShell adminName={admin.name}>{children}</DashboardShell>;
}
