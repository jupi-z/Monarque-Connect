import { Injectable, NotImplementedException } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';

@Injectable()
export class IntelligenceService {
  constructor(private readonly authorization: AuthorizationService) {}

  async requireProjectionAccess(principal: AuthPrincipal, organizationId: string): Promise<never> {
    await this.authorization.requireModule(principal, organizationId, 'INTELLIGENCE_BASIC', 'intelligence:read');
    throw new NotImplementedException('Intelligence projections are not available yet');
  }
}
