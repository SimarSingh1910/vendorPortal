import { Module } from '@nestjs/common';
import { ClinicExpenseHeadsController } from './clinic-expense-heads.controller';
import { ClinicExpenseHeadsService } from './clinic-expense-heads.service';

@Module({
  controllers: [ClinicExpenseHeadsController],
  providers: [ClinicExpenseHeadsService],
  exports: [ClinicExpenseHeadsService],
})
export class ClinicExpenseHeadsModule {}
