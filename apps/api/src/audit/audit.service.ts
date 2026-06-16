import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  entityType: string;
  entityId: string;
  action: string;
  performedById: string;
  ipAddress: string;
  oldValue?: unknown;
  newValue?: unknown;
}

/** Coerce an arbitrary value into a Prisma Json input (or DB NULL). */
function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

/**
 * Append-only audit trail writer. Today it only INSERTs rows; the DB-level
 * BEFORE UPDATE/DELETE triggers + restricted grants that hard-enforce
 * "no update, no delete, ever" are added in the dedicated audit-hardening step.
 * Callers must never expose a path that updates or deletes AuditLog.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        performedById: entry.performedById,
        // ipAddress is NOT NULL; fall back to a sentinel for non-HTTP callers.
        ipAddress: entry.ipAddress || '0.0.0.0',
        oldValue: toJson(entry.oldValue),
        newValue: toJson(entry.newValue),
      },
    });
  }
}
