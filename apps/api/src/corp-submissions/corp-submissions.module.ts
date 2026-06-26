import { Module } from '@nestjs/common';
import { CorpExpenseHeadsModule } from '../corp-expense-heads/corp-expense-heads.module';
import { CorpCycleService } from './corp-cycle.service';

/**
 * Corporate submission workflow engine (Phase C2). Step C2.1 ships corporate
 * cycle opening + head snapshot; later steps add the authoritative state machine,
 * provision data entry, and review/approval. CorpCycleService is exported for the
 * scheduler (Step C5) and cross-service use, mirroring the clinic SubmissionsModule.
 */
@Module({
  imports: [CorpExpenseHeadsModule],
  providers: [CorpCycleService],
  exports: [CorpCycleService],
})
export class CorpSubmissionsModule {}
