import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthPrincipal, StaffActorPrincipal } from './auth.types.js';

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthPrincipal }>();
    if (!request.user) throw new Error('Authenticated principal is missing');
    return request.user;
  },
);

/** Use only on routes protected by AuthGuard; legacy CurrentPrincipal stays unchanged. */
export const CurrentActorPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): StaffActorPrincipal => {
    const request = context.switchToHttp().getRequest<Request & { actorPrincipal?: StaffActorPrincipal }>();
    if (!request.actorPrincipal) throw new Error('Verified actor principal is missing');
    return request.actorPrincipal;
  },
);
