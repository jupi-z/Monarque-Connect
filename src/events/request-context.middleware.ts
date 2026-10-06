import { createRequestContext, runWithEventContext } from './event-context.js';

export function requestContextMiddleware(_request: unknown, _response: unknown, next: () => void): void {
  runWithEventContext(createRequestContext(), () => { next(); });
}
