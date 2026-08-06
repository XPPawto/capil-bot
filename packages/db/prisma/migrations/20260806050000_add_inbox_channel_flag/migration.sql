-- Channel WA (JID ...@newsletter) - siaran satu arah, dibedakan dari grup lewat kolom ini.
ALTER TABLE `InboxMessage`
  ADD COLUMN `isChannel` BOOLEAN NOT NULL DEFAULT false;
