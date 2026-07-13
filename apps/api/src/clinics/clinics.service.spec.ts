import { Test, type TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuditAction } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClinicsService } from './clinics.service';
import { CreateClinicDto } from './dto/create-clinic.dto';
import { resetDb } from '../../test/reset';

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
  };

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
});
