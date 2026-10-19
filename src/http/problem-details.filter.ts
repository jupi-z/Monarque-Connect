import { Catch, type ArgumentsHost, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { currentEventContext } from '../events/event-context.js';

@Catch(HttpException)
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    const exceptionBody = exception.getResponse();
    const detail = typeof exceptionBody === 'string' ? exceptionBody : this.extractMessage(exceptionBody);
    const requestId = currentEventContext()?.requestId ?? 'unknown';
    const retryAfterSeconds = (exception as HttpException & { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (status === 429 && typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds)) response.header('Retry-After', String(Math.max(1, Math.ceil(retryAfterSeconds))));
    response.header('X-Request-Id', requestId).status(status).type('application/problem+json').json({ type: `https://api.monarque-connect.com/problems/${status}`, title: this.title(status), status, detail, requestId });
  }

  private extractMessage(body: string | object): string | undefined {
    if (!body || typeof body !== 'object' || !('message' in body)) return undefined;
    const message = body.message;
    return Array.isArray(message) ? message.join('; ') : typeof message === 'string' ? message : undefined;
  }

  private title(status: number): string {
    return ({ 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 429: 'Too Many Requests' } as Record<number, string>)[status] ?? 'Request failed';
  }
}
