import { Logo } from "@/components/Logo";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo size={48} />
          <div>
            <h1 className="font-serif text-3xl italic tracking-tight text-ink">Selamat datang</h1>
            <p className="mt-1 text-sm text-ink-muted">Dashboard Layanan Administrasi Kelurahan</p>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-6">
          {error && (
            <p className="mb-4 rounded-md bg-pastel-red px-3 py-2 text-sm text-pastel-red-ink">{error}</p>
          )}

          <form action="/api/auth/login" method="POST" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="username" className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Username
              </label>
              <input
                id="username"
                name="username"
                required
                autoFocus
                autoComplete="username"
                className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink"
              />
            </div>
            <button
              type="submit"
              className="mt-2 rounded-md bg-ink px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#333333] active:scale-[0.98]"
            >
              Masuk
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-ink-muted">Khusus untuk petugas kelurahan yang berwenang.</p>
      </div>
    </main>
  );
}
