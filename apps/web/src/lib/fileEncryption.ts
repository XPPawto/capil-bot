import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.FILE_ENCRYPTION_KEY;
  if (!raw) throw new Error("FILE_ENCRYPTION_KEY belum diset di .env");
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) throw new Error("FILE_ENCRYPTION_KEY harus 64 karakter hex (32 byte)");
  return key;
}

/** Format input: [IV(12)][authTag(16)][ciphertext] - dari apps/bot/src/media/fileEncryption.ts. */
export function decryptBuffer(data: Buffer): Buffer {
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
