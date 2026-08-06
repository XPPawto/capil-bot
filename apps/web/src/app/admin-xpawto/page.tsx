import { getInboxConversations } from "@/lib/inbox";
import { hasValidPinCookie } from "@/lib/adminXpawtoPin";
import { InboxClient } from "./InboxClient";
import { PinGate } from "./PinGate";

// Halaman ini SENGAJA tidak ada di navigasi sidebar (juga di luar grup route (dashboard),
// full-screen tanpa sidebar/topbar) - cuma bisa dibuka dengan mengetik alamatnya langsung.
// Tetap digerbangi sesi admin (lewat layout.tsx di folder ini), DITAMBAH satu gerbang PIN
// lagi khusus halaman ini (lihat lib/adminXpawtoPin.ts) - supaya sekalipun sesi admin di
// suatu browser ketinggalan terbuka, isi percakapan warga tidak langsung kebuka tanpa PIN.
export default async function AdminInboxPage() {
  const pinOk = await hasValidPinCookie();
  if (!pinOk) return <PinGate />;

  const conversations = await getInboxConversations();
  return <InboxClient initialConversations={conversations} />;
}
