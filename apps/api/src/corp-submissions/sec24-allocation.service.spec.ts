import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CorpCycleService } from './corp-cycle.service';
import { CorpExpenseHeadsService } from '../corp-expense-heads/corp-expense-heads.service';
import { Sec24AllocationService } from './sec24-allocation.service';
import { makeCorpFixtures, type CorpFixtures } from '../../test/corp-fixtures';
import { resetDb } from '../../test/reset';
import { expectStatus } from '../../test/fixtures';

/**
 * Step C3.1 — Sec 24 allocation % is APPEND-ONLY (BR-C06): every set is a new row,
 * never an update; full history; no default (null until set, BR-C03); the %
 * effective for a month is the latest row with effectiveFromMonth ≤ month.
 */
describe('Sec24AllocationService (Step C3.1 — append-only allocation %)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let sec24: Sec24AllocationService;
  let fx: CorpFixtures;
  let admin: Awaited<ReturnType<CorpFixtures['makeUser']>>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        AuditService,
        CorpExpenseHeadsService,
        CorpCycleService,
        Sec24AllocationService,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    sec24 = moduleRef.get(Sec24AllocationService);
    fx = makeCorpFixtures(prisma, moduleRef.get(CorpCycleService));
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    admin = await fx.makeUser(UserRole.FINANCE_ADMIN);
  });

  // ── no default (BR-C03) ────────────────────────────────────────────────────────

  it('has no default: current + active-for-month are null until first set', async () => {
    expect(await sec24.getCurrent()).toBeNull();
    expect(await sec24.activePctForMonth('2026-07')).toBeNull();
  });

  // ── append-only (BR-C06) ───────────────────────────────────────────────────────

  it('every set APPENDS a new row (never updates) and keeps full history', async () => {
    await sec24.setAllocation(admin, { allocationPct: 10, effectiveFromMonth: '2026-07' });
    await sec24.setAllocation(admin, {
      allocationPct: 15,
      effectiveFromMonth: '2026-09',
      notes: 'revised',
    });

    expect(await prisma.sec24AllocationConfig.count()).toBe(2);
    const history = await sec24.getHistory();
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.allocationPct)).toEqual(['15.00', '10.00']); // newest first
    expect(history[0].setBy.id).toBe(admin.id);
  });

  // ── month-aware resolution ──────────────────────────────────────────────────────

  it('resolves the % effective for a month (latest effectiveFromMonth ≤ month)', async () => {
    await sec24.setAllocation(admin, { allocationPct: 10, effectiveFromMonth: '2026-07' });
    await sec24.setAllocation(admin, { allocationPct: 20, effectiveFromMonth: '2026-09' });

    expect(await sec24.activePctForMonth('2026-06')).toBeNull(); // before any effective row
    expect((await sec24.activePctForMonth('2026-07'))!.toFixed(2)).toBe('10.00');
    expect((await sec24.activePctForMonth('2026-08'))!.toFixed(2)).toBe('10.00');
    expect((await sec24.activePctForMonth('2026-09'))!.toFixed(2)).toBe('20.00');
    expect((await sec24.activePctForMonth('2026-12'))!.toFixed(2)).toBe('20.00');
  });

  it('getCurrent returns the latest-set allocation', async () => {
    await sec24.setAllocation(admin, { allocationPct: 10, effectiveFromMonth: '2026-07' });
    await sec24.setAllocation(admin, { allocationPct: 12.5, effectiveFromMonth: '2026-10' });
    const current = await sec24.getCurrent();
    expect(current!.allocationPct).toBe('12.50');
    expect(current!.effectiveFromMonth).toBe('2026-10');
  });

  // ── share computation (BR-C04) ──────────────────────────────────────────────────

  it('computeShare = amount × %/100 (2 dp); null when no % applies', () => {
    expect(sec24.computeShare(new Prisma.Decimal('1000'), null)).toBeNull();
    expect(sec24.computeShare(new Prisma.Decimal('1000'), new Prisma.Decimal('10'))!.toFixed(2)).toBe(
      '100.00',
    );
    expect(
      sec24.computeShare(new Prisma.Decimal('333.33'), new Prisma.Decimal('12.5'))!.toFixed(2),
    ).toBe('41.67');
  });

  // ── validation ──────────────────────────────────────────────────────────────────

  it('rejects a bad month (400) and an out-of-range % (400)', async () => {
    await expectStatus(sec24.setAllocation(admin, { allocationPct: 10, effectiveFromMonth: '2026-13' }), 400);
    await expectStatus(sec24.setAllocation(admin, { allocationPct: 150, effectiveFromMonth: '2026-07' }), 400);
  });

  // ── audit before/after ──────────────────────────────────────────────────────────

  it('audits each set as CORP_SEC24_PCT_SET with old→new (first old=null, then prior %)', async () => {
    await sec24.setAllocation(admin, { allocationPct: 10, effectiveFromMonth: '2026-07' });
    await sec24.setAllocation(admin, { allocationPct: 20, effectiveFromMonth: '2026-08' });

    const rows = await prisma.auditLog.findMany({
      where: { action: 'CORP_SEC24_PCT_SET' },
      orderBy: { performedAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].oldValue).toBeNull();
    expect((rows[0].newValue as { allocationPct: string }).allocationPct).toBe('10.00');
    expect((rows[1].oldValue as { allocationPct: string }).allocationPct).toBe('10.00');
    expect((rows[1].newValue as { allocationPct: string }).allocationPct).toBe('20.00');
  });
});
