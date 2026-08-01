import { NextResponse } from "next/server";
import type { Admin } from "@kelurahan/db";
import { getCurrentAdmin } from "./session";

type Guard = { admin: Admin } | { error: NextResponse };

export async function requireAdmin(): Promise<Guard> {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { admin };
}
