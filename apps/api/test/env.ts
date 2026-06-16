/**
 * Per-worker environment setup (runs before any provider is constructed).
 *
 * Forces DATABASE_URL at the ISOLATED test database — never the dev schema.
 * connection_limit=1 pins all queries to a single connection so the reset
 * helper's `SET FOREIGN_KEY_CHECKS=0` reliably applies to the TRUNCATEs that
 * follow it.
 */
export const TEST_DB_NAME = 'cost_provision_test';

const url = `mysql://cpp:cpp_local_dev@localhost:3307/${TEST_DB_NAME}?connection_limit=1`;

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = url;
// Not used by `migrate deploy`, but set so nothing accidentally points at dev.
process.env.SHADOW_DATABASE_URL = url;
