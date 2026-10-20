import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { IntelligenceAlertsQuery, IntelligenceAlertParams, IntelligenceDashboardQuery, IntelligenceMetricsQuery } from './intelligence.dto.js';
import { IntelligenceService } from './intelligence.service.js';

@Controller('organizations/:organizationId/intelligence')
@UseGuards(AuthGuard)
export class IntelligenceController {
  constructor(private readonly intelligence: IntelligenceService) {}

  @Get('dashboard')
  dashboard(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() query: IntelligenceDashboardQuery,
  ): Promise<never> {
    void query;
    return this.intelligence.requireProjectionAccess(principal, organizationId);
  }

  @Get('metrics')
  metrics(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() query: IntelligenceMetricsQuery,
  ): Promise<never> {
    void query;
    return this.intelligence.requireProjectionAccess(principal, organizationId);
  }

  @Get('alerts')
  alerts(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() query: IntelligenceAlertsQuery,
  ): Promise<never> {
    void query;
    return this.intelligence.requireProjectionAccess(principal, organizationId);
  }

  @Get('alerts/:alertId')
  alert(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param() params: IntelligenceAlertParams,
  ): Promise<never> {
    return this.intelligence.requireProjectionAccess(principal, params.organizationId);
  }
}
