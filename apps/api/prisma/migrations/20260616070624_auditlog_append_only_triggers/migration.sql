-- Append-only enforcement for the audit log.
--
-- BEFORE UPDATE / BEFORE DELETE triggers abort any attempt to mutate an existing
-- auditlog row. These are the PRIMARY enforcement: they block mutation for ALL
-- users regardless of grants (including the `cpp` dev user, which holds DB-level
-- ALL). Single-statement trigger bodies (SIGNAL only) so no DELIMITER is needed
-- and the migration runner can apply each statement directly.
--
-- A grant-based approach (REVOKE UPDATE, DELETE ON auditlog FROM 'cpp'@'%') is
-- best-effort only and awkward here because `cpp` owns the schema, so we rely on
-- the triggers instead and do not touch grants (keeps dev/test access intact).
--
-- NOTE: MySQL TRUNCATE does NOT fire DELETE triggers, so the test-reset TRUNCATE
-- of `auditlog` keeps working — the reset helper is unchanged.

DROP TRIGGER IF EXISTS `auditlog_no_update`;

CREATE TRIGGER `auditlog_no_update`
BEFORE UPDATE ON `auditlog`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'auditlog is append-only';

DROP TRIGGER IF EXISTS `auditlog_no_delete`;

CREATE TRIGGER `auditlog_no_delete`
BEFORE DELETE ON `auditlog`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'auditlog is append-only';
