import { NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/accessControl";
import { countNeedsReply } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";

/**
 * Dipoll berkala oleh /admin-xpawto untuk badge notifikasi di tiap tab akun (Bot Layanan +
 * semua akun ekstra sekaligus), terlepas dari tab mana yang sedang dibuka.
 */
export async function GET(): Promise<NextResponse> {
  const guard = await requireVerifiedAdmin();
  if ("error" in guard) return guard.error;

  const extraAccounts = await prisma.extraAccount.findMany({ select: { id: true } });

  const [service, ...extraCounts] = await Promise.all([
    countNeedsReply("SERVICE"),
    ...extraAccounts.map((a) => countNeedsReply("EXTRA", a.id)),
  ]);

  const extra: Record<number, number> = {};
  extraAccounts.forEach((a, i) => {
    extra[a.id] = extraCounts[i];
  });

  return NextResponse.json({ service, extra });
}
