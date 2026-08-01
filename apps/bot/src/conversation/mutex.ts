/**
 * Mutex sederhana berbasis promise-chain, per key (waJid). Baileys bisa memicu
 * beberapa event `messages.upsert` hampir bersamaan saat warga kirim beberapa
 * foto sekaligus dari galeri. Tanpa ini, dua pemrosesan pesan yang overlap akan
 * baca ConversationState yang sama lalu saling menimpa saat disimpan kembali
 * (read-modify-write race) - berkas fisik ada di storage/tmp tapi tidak semuanya
 * tercatat di context. Dengan runExclusive, pesan berikutnya dari JID yang sama
 * menunggu pesan sebelumnya selesai di-commit ke DB dulu sebelum diproses.
 */
const chains = new Map<string, Promise<void>>();

export function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = chains.get(key) ?? Promise.resolve();
  const run = prior.then(fn, fn);

  const tracked: Promise<void> = run.then(
    () => undefined,
    () => undefined
  );
  chains.set(key, tracked);
  tracked.finally(() => {
    if (chains.get(key) === tracked) {
      chains.delete(key);
    }
  });

  return run;
}
