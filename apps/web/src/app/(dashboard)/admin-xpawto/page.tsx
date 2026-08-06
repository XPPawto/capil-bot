import { getInboxConversations } from "@/lib/inbox";
import { InboxClient } from "./InboxClient";

// Halaman ini SENGAJA tidak ada di navigasi sidebar - cuma bisa dibuka dengan mengetik
// alamatnya langsung. Tetap digerbangi sesi admin yang sama seperti semua halaman
// dashboard lain (lewat (dashboard)/layout.tsx), jadi tetap butuh login yang valid.
export default async function AdminInboxPage() {
  const conversations = await getInboxConversations();
  return <InboxClient initialConversations={conversations} />;
}
