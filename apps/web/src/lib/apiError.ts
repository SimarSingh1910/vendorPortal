import axios from 'axios';
import type { ApiError } from '@portal/shared';

/** Pull a human-readable message out of an Axios error, with a fallback. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as ApiError | undefined)?.message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string') return message;
  }
  return fallback;
}
