import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Editable fields. `isActive` is changed only via deactivate/activate, never deleted. */
export class UpdateExpenseHeadDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  glAccountNo?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  glAccountName?: string;

  /**
   * Turn multi-vendor entry on or off for this head. Finance Admin only (the
   * route is already @Roles(FINANCE_ADMIN)).
   *
   * NOT retroactive: cycle-open freezes the flag onto each head snapshot, so a
   * change here affects months opened AFTERWARDS. Already-open months keep the
   * value they were opened with (BR-05), which is what stops a mid-month toggle
   * from stranding vendor lines a SPOC has already entered.
   */
  @IsOptional()
  @IsBoolean()
  allowsMultipleVendors?: boolean;
}
