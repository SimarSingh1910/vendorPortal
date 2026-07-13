import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Portal } from '@prisma/client';
import type { NotificationConfig } from '@prisma/client';
import { AuditAction, type NotificationConfigView, type PortalTab } from '@portal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationConfigDto } from './dto/notification-config.dto';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function toView(config: NotificationConfig): NotificationConfigView {
  return {
    portal: config.portal as PortalTab,
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
 * Per-cycle notification config (Step 10.1). One row per (portal, month); read by
 * the scheduler and the dashboard. Clinic and Corporate keep INDEPENDENT config.
 * Create/update is audited via the unified path. `portal` defaults to CLINIC so
 * the original clinic call sites (and their tests) are unchanged by the split.
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

  list(portal: Portal = Portal.CLINIC): Promise<NotificationConfigView[]> {
    return this.prisma.notificationConfig
      .findMany({ where: { portal }, orderBy: { month: 'desc' } })
      .then((rows) => rows.map(toView));
  }

  async get(month: string, portal: Portal = Portal.CLINIC): Promise<NotificationConfigView> {
    this.assertMonth(month);
    const config = await this.prisma.notificationConfig.findUnique({
      where: { month_portal: { month, portal } },
    });
    if (!config) {
      throw new NotFoundException('No notification config for this month');
    }
    return toView(config);
  }

  /** Create or update the (portal, month) config, audited as CREATE vs UPDATE. */
  async upsert(
    month: string,
    dto: NotificationConfigDto,
    portal: Portal = Portal.CLINIC,
  ): Promise<NotificationConfigView> {
    this.assertMonth(month);

    const existing = await this.prisma.notificationConfig.findUnique({
      where: { month_portal: { month, portal } },
    });
    const data = {
      monthStartNotifyDate: new Date(dto.monthStartNotifyDate),
      cutoffDate: new Date(dto.cutoffDate),
      preCutoffReminderDays: dto.preCutoffReminderDays,
      varianceThresholdPercent: dto.varianceThresholdPercent,
    };

    const saved = await this.prisma.notificationConfig.upsert({
      where: { month_portal: { month, portal } },
      update: data,
      create: { month, portal, ...data },
    });

    await this.audit.record({
      action: existing
        ? AuditAction.NOTIFICATION_CONFIG_UPDATE
        : AuditAction.NOTIFICATION_CONFIG_CREATE,
      entityType: 'NotificationConfig',
      entityId: saved.id,
      oldValue: existing ? toView(existing) : null,
      newValue: { portal, month, ...dto },
    });

    return toView(saved);
  }
}
