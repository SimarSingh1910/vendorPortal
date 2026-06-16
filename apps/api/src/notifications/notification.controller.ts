import { Controller, Get, Param, Post, Query, Sse, type MessageEvent } from '@nestjs/common';
import { from, map, switchMap, type Observable } from 'rxjs';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/request-user';
import { AuthService } from '../auth/auth.service';
import { NotificationService } from './notification.service';
import { NotificationEventsService } from './notification-events.service';

/**
 * In-app notifications (Step 10.2): list, unread count, mark-as-read, a live SSE
 * stream, and a self-test trigger. All authenticated; the stream authenticates
 * via a query-param token (EventSource can't send an Authorization header).
 */
@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly events: NotificationEventsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.notifications.listForUser(user.id);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: RequestUser) {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Post(':id/read')
  async markRead(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    await this.notifications.markRead(user.id, id);
    return { success: true };
  }

  @Post('read-all')
  async markAllRead(@CurrentUser() user: RequestUser) {
    await this.notifications.markAllRead(user.id);
    return { success: true };
  }

  /** Send a test notification to the caller (in-app + email). */
  @Post('test')
  test(@CurrentUser() user: RequestUser) {
    return this.notifications.create({
      userId: user.id,
      type: 'TEST',
      message: 'This is a test notification from the Cost Provision Portal.',
      emailSubject: 'Cost Provision Portal — test notification',
    });
  }

  /**
   * Live stream of new notifications for the token's user. @Public because
   * EventSource sends the access token as `?token=` rather than a header; the
   * token is verified here (same revocation checks as the global guard).
   */
  @Public()
  @Sse('stream')
  stream(@Query('token') token: string): Observable<MessageEvent> {
    return from(this.auth.verifyAccessToken(token ?? '')).pipe(
      switchMap((userId) => this.events.subscribe(userId)),
      map((notification) => ({ data: notification }) as MessageEvent),
    );
  }
}
