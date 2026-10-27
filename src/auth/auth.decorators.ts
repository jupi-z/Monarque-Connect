import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthPrincipal, VerifiedUserPrincipal } from './auth.types.js';

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthPrincipal }>();
    if (!request.user) throw new Error('Authenticated principal is missing');
    return request.user;
  },
);

/** Authentication provenance only; authorization must still derive the actor and tenant from server state. */
export const CurrentAuthenticatedIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): VerifiedUserPrincipal => {
    const request = context.switchToHttp().getRequest<Request & { authenticatedIdentity?: VerifiedUserPrincipal }>();
    if (!request.authenticatedIdentity) throw new Error('Verified internal identity is missing');
    return request.authenticatedIdentity;
  },
);
