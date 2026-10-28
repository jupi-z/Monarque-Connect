import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { FxRateService } from './fx-rate.service.js';
import { IngestFxRateDto } from './fx-rate.dto.js';

@Controller('platform/pricing')
@UseGuards(AuthGuard)
export class FxRateController {
  constructor(private readonly fxRates: FxRateService) {}

  @Post('fx-rates')
  ingest(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: IngestFxRateDto, @Headers('idempotency-key') key?: string): Promise<unknown> {
    return this.fxRates.ingest(principal, input, key);
  }
}
