import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { AuditModule } from './audit/audit.module';
import { requestContextMiddleware } from './audit/request-context.middleware';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ClinicsModule } from './clinics/clinics.module';
import { ExpenseHeadsModule } from './expense-heads/expense-heads.module';
import { ClinicExpenseHeadsModule } from './clinic-expense-heads/clinic-expense-heads.module';
import { UsersModule } from './users/users.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Load apps/api/.env in dev; real environments inject vars directly.
      envFilePath: '.env',
    }),
    PrismaModule,
    CommonModule,
    AuditModule,
    AuthModule,
    ClinicsModule,
    ExpenseHeadsModule,
    ClinicExpenseHeadsModule,
    UsersModule,
    SubmissionsModule,
    NotificationsModule,
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
