import { useEffect } from 'react';

/** 30 minutes, overridable via VITE_IDLE_TIMEOUT_MS (used to test the flow fast). */
const DEFAULT_IDLE_MS = 30 * 60 * 1000;

function idleTimeoutMs(): number {
  const raw = import.meta.env.VITE_IDLE_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IDLE_MS;
}

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'] as const;

/**
 * Calls `onIdle` after a period of no user activity (default 30 min). Any of the
 * tracked interaction events resets the countdown (throttled to once/sec). Only
 * active while `enabled` is true (i.e. when authenticated).
 */
export function useIdleTimer(onIdle: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const timeout = idleTimeoutMs();
    let timerId: ReturnType<typeof setTimeout>;
    let lastReset = 0;

    const reset = (): void => {
      clearTimeout(timerId);
      timerId = setTimeout(onIdle, timeout);
    };

    const onActivity = (): void => {
      const now = Date.now();
      if (now - lastReset > 1000) {
        lastReset = now;
        reset();
      }
    };

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));
    reset();

    return () => {
      clearTimeout(timerId);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity));
    };
  }, [onIdle, enabled]);
}
