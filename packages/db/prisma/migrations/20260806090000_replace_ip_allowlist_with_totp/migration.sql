-- Lapisan IP allowlist dicabut (terlalu rapuh untuk IP HP/rumah yang gampang berubah) -
-- digantikan TOTP (RFC 6238, kode 6 digit berganti tiap 30 detik lewat app authenticator).
ALTER TABLE `AccessControl` DROP COLUMN `networkBlob`;
ALTER TABLE `AccessControl` ADD COLUMN `totpSecret` LONGBLOB NULL;
