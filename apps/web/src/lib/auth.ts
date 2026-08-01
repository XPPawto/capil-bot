import bcrypt from "bcryptjs";
import { prisma } from "@kelurahan/db";
import type { Admin } from "@kelurahan/db";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

type LoginResult = { ok: true; admin: Admin } | { ok: false; error: string };

export async function verifyCredentials(username: string, password: string): Promise<LoginResult> {
  const admin = await prisma.admin.findUnique({ where: { username } });
  if (!admin) {
    return { ok: false, error: "Username atau password salah." };
  }

  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 60000);
    return { ok: false, error: `Akun terkunci sementara, coba lagi dalam ${minutesLeft} menit.` };
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    const failedLoginCount = admin.failedLoginCount + 1;
    const lockedUntil =
      failedLoginCount >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null;
    await prisma.admin.update({ where: { id: admin.id }, data: { failedLoginCount, lockedUntil } });
    return { ok: false, error: "Username atau password salah." };
  }

  await prisma.admin.update({ where: { id: admin.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  return { ok: true, admin };
}

export async function changePassword(adminId: number, newPassword: string): Promise<void> {
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.admin.update({ where: { id: adminId }, data: { passwordHash } });
}
