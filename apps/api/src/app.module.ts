import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { CommonModule } from './common/common.module';
import { AuditModule } from './audit/audit.module';
import { requestContextMiddleware } from './audit/request-context.middleware';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ClinicsModule } from './clinics/clinics.module';
import { ExpenseHeadsModule } from './expense-heads/expense-heads.module';
import { ClinicExpenseHeadsModule } from './clinic-expense-heads/clinic-expense-heads.module';
import { CorpDepartmentsModule } from './corp-departments/corp-departments.module';
import { CorpExpenseHeadsModule } from './corp-expense-heads/corp-expense-heads.module';
import { CorpBudgetCodesModule } from './corp-budget-codes/corp-budget-codes.module';
import { CorpSubmissionsModule } from './corp-submissions/corp-submissions.module';
import { UsersModule } from './users/users.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ExportModule } from './export/export.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Load apps/api/.env in dev; real environments inject vars directly.
      envFilePath: '.env',
    }),
    // Registers the cron runtime for the cycle scheduler (Step 10.4).
    ScheduleModule.forRoot(),
    // Rate-limiting backbone (Phase 13.1). The ThrottlerGuard is applied per-route
    // (auth endpoints) rather than globally, so SSE/long-poll routes are unaffected.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    CommonModule,
    AuditModule,
    AuthModule,
    ClinicsModule,
    ExpenseHeadsModule,
    ClinicExpenseHeadsModule,
    CorpDepartmentsModule,
    CorpExpenseHeadsModule,
    CorpBudgetCodesModule,
    CorpSubmissionsModule,
    UsersModule,
    SubmissionsModule,
    NotificationsModule,
    SchedulerModule,
    DashboardModule,
    ExportModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Wrap every request in an AsyncLocalStorage scope so the audit writer can
    // resolve the actor + IP from context (no per-service threading).
    consumer.apply(requestContextMiddleware).forRoutes('*');
  }
}
