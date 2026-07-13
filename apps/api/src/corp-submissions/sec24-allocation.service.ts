import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Sec24AllocationConfig } from '@prisma/client';
import { AuditAction, type Sec24AllocationConfigView } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../auth/request-user';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Sec 24 shared-cost-pool allocation % (Step C3.1). There is ONE global pool, so
 * the allocation timeline is global (not per-department).
 *
 * APPEND-ONLY (BR-C06): setting the % NEVER updates a row — it always inserts a
 * NEW sec24_allocation_config row (old%, new%, by, at, effective_from_month,
 * notes), giving a full searchable/exportable history. There is NO default
 * (BR-C03): until the first row exists, the active % is null and the HCL Avitas
 * share shows "—" (BR-C04). Once set, share = amount × %/100. The % effective for
 * a given month is the latest row whose effectiveFromMonth ≤ that month.
 */
@Injectable()
export class Sec24AllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Append a new allocation %. Records the before (previously-effective) → after. */
  async setAllocation(
    user: RequestUser,
    input: { allocationPct: number; effectiveFromMonth: string; notes?: string },
  ): Promise<Sec24AllocationConfig> {
    if (!MONTH_RE.test(input.effectiveFromMonth)) {
      throw new BadRequestException('effectiveFromMonth must be in YYYY-MM format');
    }
    if (input.allocationPct < 0 || input.allocationPct > 100) {
      throw new BadRequestException('allocationPct must be between 0 and 100');
    }

    // Capture the % that was effective for this row's month BEFORE the new row, so
    // the audit reads as a true old → new (BR-C06: the change is the new row).
    const previous = await this.activeRowForMonth(input.effectiveFromMonth);

    const notes = input.notes?.trim() || null;
    const row = await this.prisma.sec24AllocationConfig.create({
      data: {
        allocationPct: new Prisma.Decimal(input.allocationPct),
        effectiveFromMonth: input.effectiveFromMonth,
        notes,
        setById: user.id,
      },
    });

    await this.audit.record({
      action: AuditAction.CORP_SEC24_PCT_SET,
      entityType: 'Sec24AllocationConfig',
      entityId: row.id,
      oldValue: previous
        ? {
            allocationPct: previous.allocationPct.toFixed(2),
            effectiveFromMonth: previous.effectiveFromMonth,
          }
        : null,
      newValue: {
        allocationPct: row.allocationPct.toFixed(2),
        effectiveFromMonth: row.effectiveFromMonth,
        notes,
      },
    });

    return row;
  }

  /** Full append-only history, newest first (searchable/exportable). */
  async getHistory(): Promise<Sec24AllocationConfigView[]> {
    const rows = await this.prisma.sec24AllocationConfig.findMany({
      orderBy: [{ effectiveFromMonth: 'desc' }, { setAt: 'desc' }, { id: 'desc' }],
      include: { setBy: { select: { id: true, name: true } } },
    });
    return rows.map((r) => this.toView(r));
  }

  /** The latest-set allocation row overall, or null if none has ever been set. */
  async getCurrent(): Promise<Sec24AllocationConfigView | null> {
    const row = await this.prisma.sec24AllocationConfig.findFirst({
      orderBy: [{ effectiveFromMonth: 'desc' }, { setAt: 'desc' }, { id: 'desc' }],
      include: { setBy: { select: { id: true, name: true } } },
    });
    return row ? this.toView(row) : null;
  }

  /** The allocation row effective for `month` (latest effectiveFromMonth ≤ month), or null. */
  async activeRowForMonth(month: string): Promise<Sec24AllocationConfig | null> {
    return this.prisma.sec24AllocationConfig.findFirst({
      where: { effectiveFromMonth: { lte: month } },
      orderBy: [{ effectiveFromMonth: 'desc' }, { setAt: 'desc' }, { id: 'desc' }],
    });
  }

  /** The allocation % effective for `month`, or null when none applies yet (BR-C03/C04). */
  async activePctForMonth(month: string): Promise<Prisma.Decimal | null> {
    const row = await this.activeRowForMonth(month);
    return row?.allocationPct ?? null;
  }

  /** HCL Avitas share = amount × %/100, to 2 dp; null when no % applies (shows "—"). */
  computeShare(amount: Prisma.Decimal, pct: Prisma.Decimal | null): Prisma.Decimal | null {
    if (pct === null) return null;
    return amount.mul(pct).div(100).toDecimalPlaces(2);
  }

  private toView(
    row: Sec24AllocationConfig & { setBy: { id: string; name: string } },
  ): Sec24AllocationConfigView {
    return {
      id: row.id,
      allocationPct: row.allocationPct.toFixed(2),
      effectiveFromMonth: row.effectiveFromMonth,
      notes: row.notes ?? null,
      setAt: row.setAt.toISOString(),
      setBy: { id: row.setBy.id, name: row.setBy.name },
    };
  }
}
