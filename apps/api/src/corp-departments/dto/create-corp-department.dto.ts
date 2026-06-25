import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CorpDepartmentType } from '@portal/shared';

export class CreateCorpDepartmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name!: string;

  /**
   * Department classification. Optional on create — defaults to STANDARD (the
   * Prisma default). SHARED_COST_POOL is the Sec 24 pool (its allocation % is a
   * separate, later concern).
   */
  @IsOptional()
  @IsEnum(CorpDepartmentType)
  type?: CorpDepartmentType;
}
