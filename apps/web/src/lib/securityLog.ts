import { headers } from "next/headers";
import { prisma } from "./prisma";

/**
 * Ini murni monitoring defense-in-depth. Semua query di aplikasi ini sudah lewat Prisma
 * (parameterized query) jadi tidak ada celah SQL Injection nyata yang "diperbaiki" di sini -
 * tujuannya supaya admin bisa melihat kalau ada pihak yang sedang mencoba probing/menyerang
 * sistem (mis. lewat form login atau kolom pencarian), bukan indikasi bahwa serangan berhasil.
 */
const SUSPICIOUS_PATTERNS: [string, RegExp][] = [
  ["SQLI", /\bunion\b[\s\S]{1,30}\bselect\b/i],
  ["SQLI", /\bselect\b[\s\S]{1,60}\bfrom\b/i],
  ["SQLI", /\b(drop|alter|truncate)\b\s+\btable\b/i],
  ["SQLI", /\binsert\b\s+\binto\b[\s\S]{1,40}\bvalues\b/i],
  ["SQLI", /\bor\b\s+['"]?\d\s*=\s*['"]?\d/i],
  ["SQLI", /'\s*(or|and)\s+'?[\w']*\s*=\s*'?\w/i],
  ["SQLI", /;\s*(drop|delete|update|insert)\b/i],
  ["SQLI", /\bxp_cmdshell\b/i],
  ["SQLI", /--\s*$/],
  ["XSS", /<script[\s>]/i],
  ["XSS", /on(error|load|click|mouseover|focus)\s*=/i],
  ["XSS", /javascript:/i],
  ["XSS", /<iframe[\s>]/i],
  ["XSS", /document\.(cookie|location)/i],
  ["XSS", /<svg[^>]*onload/i],
];

export function detectSuspiciousInput(value: string): string | null {
  if (!value) return null;
  const sample = value.slice(0, 2000);
  for (const [pattern, regex] of SUSPICIOUS_PATTERNS) {
    if (regex.test(sample)) return pattern;
  }
  return null;
}

async function clientMeta(): Promise<{ ip: string; userAgent: string | null }> {
  const h = await headers();
  const ip =
    h.get("cf-connecting-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown";
  return { ip, userAgent: h.get("user-agent") };
}

/**
 * Cek satu atau beberapa field input sekaligus; field yang polanya cocok akan dicatat ke
 * SecurityLog. Selalu best-effort (gagal tulis log tidak boleh menggagalkan alur utama).
 */
export async function logSuspiciousFields(
  path: string,
  fields: Record<string, string | undefined | null>
): Promise<void> {
  const matches: [string, string, string][] = [];
  for (const [field, value] of Object.entries(fields)) {
    if (!value) continue;
    const pattern = detectSuspiciousInput(value);
    if (pattern) matches.push([field, value, pattern]);
  }
  if (matches.length === 0) return;

  try {
    const { ip, userAgent } = await clientMeta();
    await prisma.securityLog.createMany({
      data: matches.map(([field, value, pattern]) => ({
        ip,
        path,
        field,
        value: value.slice(0, 500),
        pattern,
        userAgent,
      })),
    });
  } catch {
    // logging tidak boleh mengganggu alur utama
  }
}
