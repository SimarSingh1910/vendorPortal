import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuditLogPage, AuditLogView } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditQueryDto } from './dto/audit-query.dto';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;
/** Hard cap on an export to keep a single request bounded. */
const EXPORT_LIMIT = 10000;

type AuditRowWithActor = Prisma.AuditLogGetPayload<{ include: { performedBy: { select: { name: true } } } }>;

/**
 * Read/search side of the audit log (Finance-Admin viewer + export). Filters by
 * clinic (denormalized clinicId), actor, action and performedAt range. Newest
 * first. Clinic names are resolved per-page (no FK on the denormalized column).
 */
@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(filter: AuditQueryDto): Prisma.AuditLogWhereInput {
    const performedAt: Prisma.DateTimeFilter = {};
    if (filter.from) performedAt.gte = new Date(filter.from);
    if (filter.to) performedAt.lte = new Date(filter.to);

    return {
      ...(filter.clinicId ? { clinicId: filter.clinicId } : {}),
      ...(filter.performedById ? { performedById: filter.performedById } : {}),
      ...(filter.action ? { action: filter.action } : {}),
      ...(filter.from || filter.to ? { performedAt } : {}),
    };
  }

  async search(filter: AuditQueryDto): Promise<AuditLogPage> {
    const where = this.buildWhere(filter);
    const page = filter.page ?? 1;
    const pageSize = Math.min(filter.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { performedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { performedBy: { select: { name: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const items = await this.toViews(rows);
    return { items, total, page, pageSize };
  }

  /** The filtered set for export (newest first, capped). */
  async searchForExport(filter: AuditQueryDto): Promise<AuditLogView[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: this.buildWhere(filter),
      orderBy: { performedAt: 'desc' },
      take: EXPORT_LIMIT,
      include: { performedBy: { select: { name: true } } },
    });
    return this.toViews(rows);
  }

  /** Distinct action names present, for the filter dropdown. */
  async distinctActions(): Promise<string[]> {
    const rows = await this.prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    return rows.map((r) => r.action);
  }

  private async toViews(rows: AuditRowWithActor[]): Promise<AuditLogView[]> {
    const clinicIds = [...new Set(rows.map((r) => r.clinicId).filter((id): id is string => !!id))];
    const clinics = clinicIds.length
      ? await this.prisma.clinic.findMany({ where: { id: { in: clinicIds } }, select: { id: true, name: true } })
      : [];
    const nameByClinic = new Map(clinics.map((c) => [c.id, c.name]));

    return rows.map((r) => ({
      id: r.id,
      performedAt: r.performedAt.toISOString(),
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      clinicId: r.clinicId,
      clinicName: r.clinicId ? (nameByClinic.get(r.clinicId) ?? null) : null,
      performedById: r.performedById,
      performedByName: r.performedBy?.name ?? null,
      ipAddress: r.ipAddress,
      oldValue: (r.oldValue as unknown) ?? null,
      newValue: (r.newValue as unknown) ?? null,
    }));
  }
}
