import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthPrincipal } from '../auth/auth.types.js';

@Injectable()
export class PlatformAuthorizationService {
  constructor(private readonly config: ConfigService) {}

  assertPlatformAdmin(principal: AuthPrincipal): void {
    const configured = this.config.get<string[]>('PLATFORM_ADMIN_USER_IDS') ?? [];
    if (!configured.includes(principal.userId)) throw new ForbiddenException('Platform administrator access required');
  }
}
