import { Body, Controller, Headers, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { PlatformOrganizationParam } from '../entitlements/platform-entitlement.dto.js';
import { NetworkTrustCommandService } from './network-trust-command.service.js';
import { SetNetworkTrustCommandDto } from './network-trust-command.dto.js';

@Controller('platform/organizations')
@UseGuards(AuthGuard)
export class NetworkTrustCommandController {
  constructor(private readonly commands: NetworkTrustCommandService) {}

  @Put(':organizationId/network-trust')
  async set(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param() params: PlatformOrganizationParam,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: SetNetworkTrustCommandDto,
  ): Promise<unknown> {
    return this.commands.set(principal, params.organizationId, input, idempotencyKey);
  }
}
