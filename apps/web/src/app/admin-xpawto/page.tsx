import { isMasterUnlocked } from "@kelurahan/db";
import { getInboxConversations } from "@/lib/inbox";
import { hasValidPinCookie } from "@/lib/adminXpawtoPin";
import { InboxClient } from "./InboxClient";
import { PinGate } from "./PinGate";
import { MasterLockScreen } from "./MasterLockScreen";

// Halaman ini SENGAJA tidak ada di navigasi sidebar (juga di luar grup route (dashboard),
// full-screen tanpa sidebar/topbar) - cuma bisa dibuka dengan mengetik alamatnya langsung.
// Tetap digerbangi sesi admin (lewat layout.tsx di folder ini), DITAMBAH dua gerbang lagi
// khusus halaman ini, berurutan:
//  1. Sakelar gembok master (lihat komentar model AdminLockState di schema.prisma) - terkunci
//     secara DEFAULT, cuma bisa dibuka lewat perintah Telegram. Dicek PALING AWAL: kalau
//     terkunci, PIN cookie yang masih valid sekalipun tidak relevan - tetap tampilkan layar
//     terkunci, bukan gerbang PIN (supaya tidak menyesatkan/buang percobaan PIN sia-sia).
//  2. Gerbang PIN+TOTP (lib/adminXpawtoPin.ts) - supaya sekalipun sesi admin di suatu
//     browser ketinggalan terbuka, isi percakapan warga tidak langsung kebuka tanpa PIN.
export default async function AdminInboxPage() {
  const { unlocked } = await isMasterUnlocked();
  if (!unlocked) return <MasterLockScreen />;

  const pinOk = await hasValidPinCookie();
  if (!pinOk) return <PinGate />;

  const conversations = await getInboxConversations();
  return <InboxClient initialConversations={conversations} />;
}
