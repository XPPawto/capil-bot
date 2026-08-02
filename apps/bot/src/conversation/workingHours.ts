const WORK_START_HOUR = 8;
const WORK_END_HOUR = 16;
const TIME_ZONE = "Asia/Jakarta";
const WEEKEND_DAYS = new Set(["Sat", "Sun"]);

/** Jam kerja tetap dihitung di zona WIB apapun timezone server-nya. */
export function isWithinWorkingHours(date: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);

  if (WEEKEND_DAYS.has(weekday)) return false;
  return hour >= WORK_START_HOUR && hour < WORK_END_HOUR;
}

export const WORKING_HOURS_NOTE =
  "\n\nCatatan: berkas Anda diterima di luar jam kerja. Petugas akan mulai memeriksa pada jam kerja " +
  "berikutnya (Senin-Jumat, 08.00-16.00 WIB).";
