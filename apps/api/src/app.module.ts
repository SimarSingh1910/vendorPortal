import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ClinicsModule } from './clinics/clinics.module';
import { ExpenseHeadsModule } from './expense-heads/expense-heads.module';
import { ClinicExpenseHeadsModule } from './clinic-expense-heads/clinic-expense-heads.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Load apps/api/.env in dev; real environments inject vars directly.
      envFilePath: '.env',
    }),
    PrismaModule,
    CommonModule,
    AuthModule,
    ClinicsModule,
    ExpenseHeadsModule,
    ClinicExpenseHeadsModule,
    UsersModule,
    HealthModule,
  ],
})
export class AppModule {}
