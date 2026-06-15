import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/** Metadata key read by JwtAccessGuard to skip authentication. */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Exempt a route (or an entire controller) from the global JwtAccessGuard —
 * e.g. login, refresh, and the health probe.
 */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
