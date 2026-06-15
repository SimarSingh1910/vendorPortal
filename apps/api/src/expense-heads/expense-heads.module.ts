import { Module } from '@nestjs/common';
import { ExpenseHeadsController } from './expense-heads.controller';
import { ExpenseHeadsService } from './expense-heads.service';

@Module({
  controllers: [ExpenseHeadsController],
  providers: [ExpenseHeadsService],
  exports: [ExpenseHeadsService],
})
export class ExpenseHeadsModule {}
