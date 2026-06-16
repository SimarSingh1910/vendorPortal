import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';
import type { NotificationView } from '@portal/shared';

/**
 * In-memory per-user event bus for the in-app (SSE) channel. The notification
 * service publishes here; the SSE endpoint subscribes per user. One Subject per
 * user, created lazily and kept for the process lifetime (fine at this scale;
 * a multi-instance deployment would swap this for Redis pub/sub).
 */
@Injectable()
export class NotificationEventsService {
  private readonly streams = new Map<string, Subject<NotificationView>>();

  private streamFor(userId: string): Subject<NotificationView> {
    let subject = this.streams.get(userId);
    if (!subject) {
      subject = new Subject<NotificationView>();
      this.streams.set(userId, subject);
    }
    return subject;
  }

  subscribe(userId: string): Observable<NotificationView> {
    return this.streamFor(userId).asObservable();
  }

  publish(userId: string, notification: NotificationView): void {
    this.streamFor(userId).next(notification);
  }
}
