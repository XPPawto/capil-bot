import { getCurrentAdmin } from "@/lib/session";

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
        <h1 className="text-xl font-semibold text-neutral-900">Akun</h1>
        <p className="text-sm text-neutral-500">Masuk sebagai {admin?.username}</p>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {success && (
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Password berhasil diubah.
        </p>
      )}

      <form action="/api/auth/change-password" method="POST" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="currentPassword" className="text-sm font-medium text-neutral-700">
            Password Saat Ini
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            required
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="newPassword" className="text-sm font-medium text-neutral-700">
            Password Baru
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            required
            minLength={8}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          <p className="text-xs text-neutral-500">Minimal 8 karakter.</p>
        </div>
        <button
          type="submit"
          className="w-fit rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Simpan Password Baru
        </button>
      </form>
    </div>
  );
}
