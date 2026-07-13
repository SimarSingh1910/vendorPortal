import { Module } from '@nestjs/common';
import { CorpExpenseHeadsController } from './corp-expense-heads.controller';
import { CorpExpenseHeadsService } from './corp-expense-heads.service';

@Module({
  controllers: [CorpExpenseHeadsController],
  providers: [CorpExpenseHeadsService],
  exports: [CorpExpenseHeadsService],
})
export class CorpExpenseHeadsModule {}
