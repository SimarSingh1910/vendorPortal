import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Single shared Prisma connection for the app. Connects on module init and
 * disconnects on shutdown so the pool is cleanly released.
 *
 * `PRISMA_TX_TIMEOUT_MS` raises the interactive-transaction timeout from Prisma's
 * 5s default. It exists for the seed scripts, which drive the real services from a
 * developer's machine against a REMOTE database: a round trip over Railway's public
 * proxy is ~300ms, so a transaction that is instant in-cluster (setMappings does 16
 * queries, saveEntries far more) overruns 5s and aborts mid-way. Unset — which is
 * every deployed environment — the default is unchanged.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      transactionOptions: {
        timeout: Number(process.env.PRISMA_TX_TIMEOUT_MS ?? 5000),
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
