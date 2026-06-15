import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@portal/shared';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Liveness probe. Public, unauthenticated — used by load balancers,
 * docker healthchecks, and the acceptance check for STEP 0.1.
 */
@Public()
@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      service: 'cost-provision-api',
      timestamp: new Date().toISOString(),
    };
  }
}
