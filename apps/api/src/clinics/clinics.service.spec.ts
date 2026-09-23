import { Test, type TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuditAction, UserRole } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClinicsService } from './clinics.service';
import { CreateClinicDto } from './dto/create-clinic.dto';
import { resetDb } from '../../test/reset';
import { expectStatus } from '../../test/fixtures';

/** Clinic master: fixed admin-set Acc. Location Code + Customer Code. */
describe('ClinicsService (Acc. Location Code + Customer Code)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: ClinicsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [PrismaService, AuditService, ClinicsService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(ClinicsService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  const validInput = {
    name: 'Pune Tech Park Clinic',
    accLocationCode: 'LOC-PUN',
    customerCode: 'CUST-PUN',
    customerName: 'Pune Customer',
  };

  /** A clinic-scoped user covering `clinicIds` (raw insert — UsersService isn't wired here). */
  const makeSpoc = (mail: string, clinicIds: string[]) =>
    prisma.user.create({
      data: {
        name: 'SPOC',
        email: mail,
        passwordHash: 'x'.repeat(60),
        role: UserRole.CLINIC_SPOC,
        assignments: { create: clinicIds.map((clinicId) => ({ clinicId })) },
      },
    });

  it('create persists both codes; get/list return them', async () => {
    const clinic = await service.create(validInput);
    expect(clinic).toMatchObject({ accLocationCode: 'LOC-PUN', customerCode: 'CUST-PUN' });

    const fetched = await service.get(clinic.id);
    expect(fetched).toMatchObject({ accLocationCode: 'LOC-PUN', customerCode: 'CUST-PUN' });

    const list = await service.list('all');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ accLocationCode: 'LOC-PUN', customerCode: 'CUST-PUN' });
  });

  it('the CreateClinicDto requires BOTH codes', async () => {
    const missingAcc = await validate(
      plainToInstance(CreateClinicDto, { ...validInput, accLocationCode: undefined }),
    );
    expect(missingAcc.some((e) => e.property === 'accLocationCode')).toBe(true);

    const missingCust = await validate(
      plainToInstance(CreateClinicDto, { ...validInput, customerCode: undefined }),
    );
    expect(missingCust.some((e) => e.property === 'customerCode')).toBe(true);

    const ok = await validate(plainToInstance(CreateClinicDto, validInput));
    expect(ok).toHaveLength(0);
  });

  it('update persists the codes and records them in the CLINIC_UPDATE audit old→new', async () => {
    const clinic = await service.create(validInput);
    await service.update(clinic.id, { accLocationCode: 'LOC-PUN-2', customerCode: 'CUST-PUN-2' });

    const fetched = await service.get(clinic.id);
    expect(fetched).toMatchObject({ accLocationCode: 'LOC-PUN-2', customerCode: 'CUST-PUN-2' });

    const rows = await prisma.auditLog.findMany({
      where: { action: AuditAction.CLINIC_UPDATE, entityId: clinic.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].oldValue).toMatchObject({ accLocationCode: 'LOC-PUN', customerCode: 'CUST-PUN' });
    expect(rows[0].newValue).toMatchObject({
      accLocationCode: 'LOC-PUN-2',
      customerCode: 'CUST-PUN-2',
    });
  });

  // ── safe delete ────────────────────────────────────────────────────────────
  // A clinic is hard-deleted ONLY when it carries no history; anything else is a
  // 409 telling the admin to deactivate instead.

  it('remove deletes a clinic with no history, cascades its assignments and audits CLINIC_DELETE', async () => {
    const clinic = await service.create(validInput);
    const other = await service.create({
      ...validInput,
      name: 'Other Clinic',
      accLocationCode: 'LOC-OTH',
      customerCode: 'CUST-OTH',
    });
    // Covers BOTH clinics, so the delete still leaves it with one — not a blocker.
    const spoc = await makeSpoc('spoc@test.local', [clinic.id, other.id]);

    const removed = await service.remove(clinic.id);
    expect(removed.id).toBe(clinic.id);
    expect(await prisma.clinic.findUnique({ where: { id: clinic.id } })).toBeNull();

    // The user survives; only the assignment to the deleted clinic cascaded away.
    const assignments = await prisma.userClinicAssignment.findMany({ where: { userId: spoc.id } });
    expect(assignments.map((a) => a.clinicId)).toEqual([other.id]);

    // The cascade IS an assignment change, so their live access tokens (which
    // carry clinicIds as a claim) must be invalidated with it.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: spoc.id } });
    expect(after.tokenVersion).toBe(spoc.tokenVersion + 1);

    const rows = await prisma.auditLog.findMany({
      where: { action: AuditAction.CLINIC_DELETE, entityId: clinic.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].clinicId).toBe(clinic.id);
    // The row is gone — the audit oldValue is the only surviving record of it.
    expect(rows[0].oldValue).toMatchObject({
      name: 'Pune Tech Park Clinic',
      accLocationCode: 'LOC-PUN',
      customerCode: 'CUST-PUN',
    });
  });

  it('remove refuses (409) a clinic with submissions, naming the count', async () => {
    const clinic = await service.create(validInput);
    await prisma.monthlySubmission.createMany({
      data: [
        { clinicId: clinic.id, month: '2026-01' },
        { clinicId: clinic.id, month: '2026-02' },
      ],
    });

    await expectStatus(service.remove(clinic.id), 409);
    await expect(service.remove(clinic.id)).rejects.toThrow(
      'This clinic has 2 monthly submissions and cannot be deleted. Deactivate it instead.',
    );
    // MonthlySubmission.clinicId is ON DELETE CASCADE — this 409 is the only thing
    // standing between the admin's click and the clinic's whole history.
    expect(await prisma.clinic.findUnique({ where: { id: clinic.id } })).not.toBeNull();
    expect(await prisma.monthlySubmission.count({ where: { clinicId: clinic.id } })).toBe(2);
  });

  it('remove refuses (409) when it is a user’s only clinic', async () => {
    const clinic = await service.create(validInput);
    await makeSpoc('only@test.local', [clinic.id]);

    await expectStatus(service.remove(clinic.id), 409);
    await expect(service.remove(clinic.id)).rejects.toThrow(
      'This clinic is the only clinic assigned to 1 user and cannot be deleted.',
    );
    expect(await prisma.clinic.findUnique({ where: { id: clinic.id } })).not.toBeNull();
  });
});
