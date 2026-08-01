import crypto from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@kelurahan/db";
import type { Admin } from "@kelurahan/db";

export const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "kb_session";
const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 12);
export const SESSION_TTL_SECONDS = TTL_HOURS * 60 * 60;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Sesi disimpan di DB (bukan JWT) supaya tombol logout = revoke langsung
 * tanpa perlu mekanisme blacklist token.
 */
export async function createSession(adminId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await prisma.session.create({ data: { adminId, tokenHash, expiresAt } });
  return token;
}

export async function getCurrentAdmin(): Promise<Admin | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({ where: { tokenHash }, include: { admin: true } });
  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  return session.admin;
}

export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
