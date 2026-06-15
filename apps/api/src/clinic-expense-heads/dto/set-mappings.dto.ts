import { ArrayUnique, IsArray, IsString } from 'class-validator';

/** The exact set of expense heads that should be actively mapped to a clinic. */
export class SetMappingsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  expenseHeadIds!: string[];
}
