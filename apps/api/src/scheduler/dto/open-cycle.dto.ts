import { IsOptional, IsString } from 'class-validator';

/**
 * Body for the admin "open now / re-run" endpoint. With `clinicId` it opens that
 * single clinic's cycle; omitted, it opens every active clinic for the month.
 */
export class OpenCycleDto {
  @IsOptional()
  @IsString()
  clinicId?: string;
}
