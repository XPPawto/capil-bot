import { getCurrentAdmin } from "@/lib/session";
import { PasswordInput } from "./PasswordInput";

export default async function AkunPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const admin = await getCurrentAdmin();
  const { error, success } = await searchParams;

  return (
    <div className="flex max-w-md flex-col gap-6">
      <div>
        <h1 className="font-serif text-3xl italic tracking-tight text-ink">Akun</h1>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-pastel-blue text-base font-semibold text-pastel-blue-ink">
          {admin?.name?.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <p className="text-sm font-medium text-ink">{admin?.name}</p>
          <p className="text-xs text-ink-muted">@{admin?.username}</p>
        </div>
      </div>

      {error && <p className="rounded-md bg-pastel-red px-3 py-2 text-sm text-pastel-red-ink">{error}</p>}
      {success && (
        <p className="rounded-md bg-pastel-green px-3 py-2 text-sm text-pastel-green-ink">
          Password berhasil diubah.
        </p>
      )}

      <form
        action="/api/auth/change-password"
        method="POST"
        className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5"
      >
        <p className="text-sm font-medium text-ink">Ubah Password</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="currentPassword" className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Password Saat Ini
          </label>
          <PasswordInput id="currentPassword" name="currentPassword" required autoComplete="current-password" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="newPassword" className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Password Baru
          </label>
          <PasswordInput id="newPassword" name="newPassword" required minLength={8} autoComplete="new-password" />
          <p className="text-xs text-ink-muted">Minimal 8 karakter.</p>
        </div>
        <button
          type="submit"
          className="w-fit rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-canvas transition-colors hover:opacity-90"
        >
          Simpan Password Baru
        </button>
      </form>
    </div>
  );
}
