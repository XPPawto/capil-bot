import { BotClient } from "./BotClient";

export default function BotPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Koneksi Bot WhatsApp</h1>
        <p className="text-sm text-neutral-500">Kelola nomor WhatsApp yang digunakan bot untuk melayani warga.</p>
      </div>
      <BotClient />
    </div>
  );
}
