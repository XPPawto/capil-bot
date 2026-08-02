"use client";

import { useState } from "react";
import { TakeoverToggle } from "./TakeoverToggle";
import { MessageThread } from "./MessageThread";

interface MessageItem {
  id: number;
  direction: "OUTBOUND" | "INBOUND";
  message: string;
  createdAt: string;
  adminName: string | null;
  hasAudio: boolean;
}

/**
 * Membagi state "active" (ambil alih atau tidak) antara TakeoverToggle dan MessageThread -
 * petugas hanya boleh kirim pesan manual kalau sudah mengambil alih, supaya bot tidak ikut
 * membalas warga di saat bersamaan (menghindari dua balasan yang tabrakan/membingungkan).
 */
export function ConversationPanel({
  requestId,
  initialActive,
  messages,
}: {
  requestId: string;
  initialActive: boolean;
  messages: MessageItem[];
}) {
  const [active, setActive] = useState(initialActive);

  return (
    <>
      <TakeoverToggle requestId={requestId} active={active} onToggled={setActive} />
      <MessageThread requestId={requestId} messages={messages} disabled={!active} />
    </>
  );
}
