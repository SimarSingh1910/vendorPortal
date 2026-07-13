import type { Sec24AllocationConfigView, Sec24AllocationInput } from '@portal/shared';
import { apiClient } from '@/lib/apiClient';

/**
 * Sec 24 allocation-% configuration (Step C3.1, config UI → CF.3). Finance-Admin
 * + Corporate tab. The % is APPEND-ONLY: setting it appends a new history row,
 * never edits in place. `current` is null until the first % is ever set (→ "—").
 */

/** The latest-set allocation, or null when none has ever been set. */
export async function getCurrentSec24(): Promise<Sec24AllocationConfigView | null> {
  const { data } = await apiClient.get<Sec24AllocationConfigView | null>(
    '/corp/sec24/allocation/current',
  );
  return data;
}

/** Full append-only allocation history, newest first. */
export async function getSec24History(): Promise<Sec24AllocationConfigView[]> {
  const { data } = await apiClient.get<Sec24AllocationConfigView[]>('/corp/sec24/allocation/history');
  return data;
}

/** Append a new allocation % (never an update). */
export async function setSec24Allocation(
  input: Sec24AllocationInput,
): Promise<Sec24AllocationConfigView> {
  const { data } = await apiClient.post<Sec24AllocationConfigView>('/corp/sec24/allocation', input);
  return data;
}
