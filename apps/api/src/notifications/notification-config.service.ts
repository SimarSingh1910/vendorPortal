import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { NotificationConfig } from '@prisma/client';
import { AuditAction, type NotificationConfigView } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationConfigDto } from './dto/notification-config.dto';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function toView(config: NotificationConfig): NotificationConfigView {
  return {
    month: config.month,
    monthStartNotifyDate: config.monthStartNotifyDate.toISOString(),
    cutoffDate: config.cutoffDate.toISOString(),
    preCutoffReminderDays: config.preCutoffReminderDays,
    varianceThresholdPercent: config.varianceThresholdPercent.toFixed(2),
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  };
}

/**
 * Per-cycle notification config (Step 10.1). One row per month; read by the
 * scheduler and the dashboard. Create/update is audited via the unified path.
 */
@Injectable()
export class NotificationConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertMonth(month: string): void {
    if (!MONTH_RE.test(month)) {
      throw new BadRequestException('month must be in YYYY-MM format');
    }
  }

  list(): Promise<NotificationConfigView[]> {
    return this.prisma.notificationConfig
      .findMany({ orderBy: { month: 'desc' } })
      .then((rows) => rows.map(toView));
  }

  async get(month: string): Promise<NotificationConfigView> {
    this.assertMonth(month);
    const config = await this.prisma.notificationConfig.findUnique({ where: { month } });
    if (!config) {
      throw new NotFoundException('No notification config for this month');
    }
    return toView(config);
  }

  /** Create or update the month's config, audited as CREATE vs UPDATE. */
  async upsert(month: string, dto: NotificationConfigDto): Promise<NotificationConfigView> {
    this.assertMonth(month);

    const existing = await this.prisma.notificationConfig.findUnique({ where: { month } });
    const data = {
      monthStartNotifyDate: new Date(dto.monthStartNotifyDate),
      cutoffDate: new Date(dto.cutoffDate),
      preCutoffReminderDays: dto.preCutoffReminderDays,
      varianceThresholdPercent: dto.varianceThresholdPercent,
    };

    const saved = await this.prisma.notificationConfig.upsert({
      where: { month },
      update: data,
      create: { month, ...data },
    });

    await this.audit.record({
      action: existing
        ? AuditAction.NOTIFICATION_CONFIG_UPDATE
        : AuditAction.NOTIFICATION_CONFIG_CREATE,
      entityType: 'NotificationConfig',
      entityId: saved.id,
      oldValue: existing ? toView(existing) : null,
      newValue: { month, ...dto },
    });

    return toView(saved);
  }
}
