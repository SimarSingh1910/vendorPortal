import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsNumber, Max, Min } from 'class-validator';

/** Finance-Admin input to set/update a month's notification config (BR-12). */
export class NotificationConfigDto {
  @IsISO8601()
  monthStartNotifyDate!: string;

  @IsISO8601()
  cutoffDate!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  preCutoffReminderDays!: number;

  // DECIMAL(5,2): 0.00 – 999.99.
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999.99)
  varianceThresholdPercent!: number;
}
