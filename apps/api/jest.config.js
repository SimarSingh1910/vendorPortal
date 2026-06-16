/**
 * Jest config for @portal/api integration tests.
 *
 * Tests run SERIALLY (maxWorkers: 1) because every spec shares the single
 * `cost_provision_test` database and truncates it in beforeEach — parallel
 * workers would clobber each other's data.
 *
 * `test/env.ts` (setupFiles) forces DATABASE_URL at the test DB before any
 * provider is constructed; `test/global-setup.ts` runs `prisma migrate deploy`
 * against it once before the suite.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFiles: ['<rootDir>/test/env.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  maxWorkers: 1,
  testTimeout: 60000,
};
