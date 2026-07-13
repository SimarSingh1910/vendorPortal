import { Module } from '@nestjs/common';
import { CorpBudgetCodesController } from './corp-budget-codes.controller';
import { CorpBudgetCodesService } from './corp-budget-codes.service';

@Module({
  controllers: [CorpBudgetCodesController],
  providers: [CorpBudgetCodesService],
  exports: [CorpBudgetCodesService],
})
export class CorpBudgetCodesModule {}
