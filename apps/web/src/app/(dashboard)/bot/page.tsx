import { BotClient } from "./BotClient";

export default function BotPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-3xl italic tracking-tight text-ink">Koneksi Bot WhatsApp</h1>
        <p className="mt-1 text-sm text-ink-muted">Kelola nomor WhatsApp yang digunakan bot untuk melayani warga.</p>
      </div>
      <BotClient />
    </div>
  );
}
