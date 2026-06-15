CREATE DATABASE IF NOT EXISTS cost_provision_shadow
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

GRANT ALL PRIVILEGES ON cost_provision.*        TO 'cpp'@'%';
GRANT ALL PRIVILEGES ON cost_provision_shadow.* TO 'cpp'@'%';
FLUSH PRIVILEGES;
