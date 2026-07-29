import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateExpenseHeadDto {
  /** G/L Account No. — required, unique (uniqueness enforced at the service/DB layer). */
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  glAccountNo!: string;

  /** G/L Account Name — required descriptive name. */
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  glAccountName!: string;

  /**
   * Allow the SPOC to enter several vendor lines against this head. Optional;
   * omitted means false (single-vendor), matching the column default. Finance
   * Admin only — the route is already @Roles(FINANCE_ADMIN).
   */
  @IsOptional()
  @IsBoolean()
  allowsMultipleVendors?: boolean;
}
