import { Module } from '@nestjs/common';
import { CorpDepartmentScopeService } from '../corp-submissions/corp-department-scope.service';
import { AttachmentsService } from './attachments.service';
import { AttachmentsController } from './attachments.controller';

/**
 * Review-comment attachments — proof for overrides, send-backs and approvals.
 *
 * ONE module serving BOTH portals: it owns the shared validate/persist/download
 * service and the single authenticated download route. The clinic and corporate
 * workflow modules import it to write attachments inside their own transaction,
 * which is what keeps files atomic with the comment they evidence.
 *
 * CorpDepartmentScopeService is provided here (rather than importing the whole
 * corporate submissions module) so this module stays a leaf — importing
 * CorpSubmissionsModule would create a cycle, since that module imports this one
 * to attach files to corporate comments.
 */
@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentsService, CorpDepartmentScopeService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
