import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

/** Finance "Send reminder": the submissions to chase (one row each on the dashboard). */
export class SendRemindersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  submissionIds!: string[];
}
