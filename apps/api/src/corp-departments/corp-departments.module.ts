import { Module } from '@nestjs/common';
import { CorpDepartmentsController } from './corp-departments.controller';
import { CorpDepartmentsService } from './corp-departments.service';

@Module({
  controllers: [CorpDepartmentsController],
  providers: [CorpDepartmentsService],
  exports: [CorpDepartmentsService],
})
export class CorpDepartmentsModule {}
