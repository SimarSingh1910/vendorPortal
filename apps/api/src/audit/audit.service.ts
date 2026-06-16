import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { currentActor } from './request-context';

export interface AuditRecord {
  action: string;
  entityType: string;
  entityId: string;
  /** Denormalized clinic for FR-09 clinic-scoped search; omit for non-clinic actions. */
  clinicId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

/** Coerce an arbitrary value into a Prisma Json input (or DB NULL). */
function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

/**
 * Append-only audit trail writer (the single write path). Actor + IP come from
 * the request context (AsyncLocalStorage) — no service threads them through.
 * Outside a request (scheduler) the actor/IP are null (SYSTEM action).
 *
 * INSERT only. The DB-level BEFORE UPDATE/DELETE triggers (audit-hardening
 * migration) hard-enforce immutability regardless of grants, so this service
 * exposes no update/delete path.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditRecord): Promise<void> {
    const { userId, ipAddress } = currentActor();
    await this.prisma.auditLog.create({
      data: {
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        clinicId: entry.clinicId ?? null,
        performedById: userId,
        ipAddress,
        oldValue: toJson(entry.oldValue),
        newValue: toJson(entry.newValue),
      },
    });
  }
}
