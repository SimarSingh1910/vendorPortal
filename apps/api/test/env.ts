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
// @prisma/client loads apps/api/.env on construction, which in a dev checkout
// carries SCHEDULER_ENABLED=false — that kill-switch would make every
// runDailyJobs() test silently do nothing. Set it first: dotenv never overrides
// a variable that is already present.
process.env.SCHEDULER_ENABLED = 'true';
