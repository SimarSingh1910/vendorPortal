CREATE DATABASE IF NOT EXISTS cost_provision_shadow
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Isolated database for the automated test suite (apps/api). Kept separate from
-- the dev `cost_provision` schema so tests can truncate freely without touching
-- dev data.
CREATE DATABASE IF NOT EXISTS cost_provision_test
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

GRANT ALL PRIVILEGES ON cost_provision.*        TO 'cpp'@'%';
GRANT ALL PRIVILEGES ON cost_provision_shadow.* TO 'cpp'@'%';
GRANT ALL PRIVILEGES ON cost_provision_test.*   TO 'cpp'@'%';
FLUSH PRIVILEGES;
