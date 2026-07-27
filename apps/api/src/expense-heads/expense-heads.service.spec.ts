import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuditAction } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ExpenseHeadsService } from './expense-heads.service';
import { CreateExpenseHeadDto } from './dto/create-expense-head.dto';
import { resetDb } from '../../test/reset';

describe('ExpenseHeadsService (G/L account expense heads)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: ExpenseHeadsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [PrismaService, AuditService, ExpenseHeadsService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(ExpenseHeadsService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('create persists glAccountNo + glAccountName; the list returns them', async () => {
    const head = await service.create({ glAccountNo: '400100', glAccountName: 'Radiology Services' });
    expect(head).toMatchObject({ glAccountNo: '400100', glAccountName: 'Radiology Services' });

    const list = await service.list('all');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ glAccountNo: '400100', glAccountName: 'Radiology Services' });
  });

  it('rejects a duplicate glAccountNo on create with a 409 Conflict', async () => {
    await service.create({ glAccountNo: '400100', glAccountName: 'Radiology Services' });
    await expect(
      service.create({ glAccountNo: '400100', glAccountName: 'Something Else' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an update that collides with another head’s glAccountNo (409 Conflict)', async () => {
    await service.create({ glAccountNo: '400100', glAccountName: 'Rent' });
    const power = await service.create({ glAccountNo: '400200', glAccountName: 'Power' });
    await expect(service.update(power.id, { glAccountNo: '400100' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('the CreateExpenseHeadDto requires BOTH G/L fields', async () => {
    const missingNo = await validate(plainToInstance(CreateExpenseHeadDto, { glAccountName: 'Rent' }));
    expect(missingNo.some((e) => e.property === 'glAccountNo')).toBe(true);

    const missingName = await validate(plainToInstance(CreateExpenseHeadDto, { glAccountNo: '400100' }));
    expect(missingName.some((e) => e.property === 'glAccountName')).toBe(true);

    const ok = await validate(
      plainToInstance(CreateExpenseHeadDto, { glAccountNo: '400100', glAccountName: 'Rent' }),
    );
    expect(ok).toHaveLength(0);
  });

  it('the update audit old→new payload uses the G/L field keys', async () => {
    const head = await service.create({ glAccountNo: '400100', glAccountName: 'Rent' });
    await service.update(head.id, { glAccountName: 'Radiology Services' });

    const rows = await prisma.auditLog.findMany({
      where: { action: AuditAction.EXPENSE_HEAD_UPDATE, entityId: head.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].oldValue).toMatchObject({ glAccountNo: '400100', glAccountName: 'Rent' });
    expect(rows[0].newValue).toMatchObject({ glAccountName: 'Radiology Services' });
  });
});
