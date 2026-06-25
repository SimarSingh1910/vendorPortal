import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CorpDepartmentType } from '@portal/shared';

/**
 * Editable department fields. `isActive` is intentionally NOT here — activation
 * is an explicit lifecycle action (deactivate/activate endpoints), never a
 * silent field edit, and we never delete data (BR-C10).
 */
export class UpdateCorpDepartmentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsEnum(CorpDepartmentType)
  type?: CorpDepartmentType;
}
