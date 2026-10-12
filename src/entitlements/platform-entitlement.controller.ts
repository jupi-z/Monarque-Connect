import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { EffectiveEntitlementsService } from './effective-entitlements.service.js';
import { EntitlementOverrideService } from './entitlement-override.service.js';
import { PlatformAuthorizationService } from './platform-authorization.service.js';
import { PlatformOrganizationParam, SetPlatformEntitlementDto } from './platform-entitlement.dto.js';

@Controller('platform/organizations')
@UseGuards(AuthGuard)
export class PlatformEntitlementController {
  constructor(
    private readonly platformAuthorization: PlatformAuthorizationService,
    private readonly overrides: EntitlementOverrideService,
    private readonly entitlements: EffectiveEntitlementsService,
  ) {}

  @Get(':organizationId/entitlements')
  async list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: PlatformOrganizationParam): Promise<unknown> {
    this.platformAuthorization.assertPlatformAdmin(principal);
    const projection = await this.entitlements.resolve(params.organizationId);
    return { effective: projection, overrides: await this.overrides.list(params.organizationId) };
  }

  @Post(':organizationId/entitlements')
  async set(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: PlatformOrganizationParam, @Body() input: SetPlatformEntitlementDto): Promise<unknown> {
    this.platformAuthorization.assertPlatformAdmin(principal);
    const overrideInput = {
      organizationId: params.organizationId,
      moduleCode: input.moduleCode,
      effect: input.effect,
      reason: input.reason,
      ...(input.startsAt ? { startsAt: new Date(input.startsAt) } : {}),
      ...(input.endsAt ? { endsAt: new Date(input.endsAt) } : {}),
      ...(input.limits ? { limits: input.limits } : {}),
      actorId: principal.userId,
    };
    return this.overrides.set(overrideInput);
  }
}
