import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { TokenService } from './token.service.js';
import type { AuthPrincipal, StaffActorPrincipal } from './auth.types.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthPrincipal; actorPrincipal?: StaffActorPrincipal }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    try {
      const claims = await this.tokens.verifyAccessToken(header.slice('Bearer '.length));
      const session = await this.prisma.refreshSession.findFirst({
        where: { id: claims.sid, userId: claims.sub, revokedAt: null, expiresAt: { gt: new Date() }, user: { status: 'ACTIVE' } },
        select: { id: true },
      });
      if (!session) throw new Error('Session is not active');
      request.user = { userId: claims.sub, sessionId: claims.sid };
      request.actorPrincipal = {
        actorType: 'STAFF',
        userId: claims.sub,
        sessionId: claims.sid,
        provenance: { kind: 'LEGACY_SESSION' },
      };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
