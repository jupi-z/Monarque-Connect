import { expect } from 'vitest';
import type { Response } from 'supertest';

type DiagnosticSnapshot = () => Promise<unknown>;

/** Log only redacted problem details and caller-selected database state on an unexpected status. */
export async function expectHttpStatusWithDiagnostics(
  response: Response,
  expectedStatus: number,
  suite: string,
  operation: string,
  snapshot?: DiagnosticSnapshot,
): Promise<Response> {
  if (response.status !== expectedStatus) {
    const body = response.body as Record<string, unknown> | undefined;
    const problem = body && typeof body === 'object'
      ? Object.fromEntries(['type', 'title', 'status', 'detail', 'code', 'requestId']
          .filter((key) => key in body)
          .map((key) => [key, redact(body[key])]))
      : undefined;
    const state = snapshot ? await snapshot() : undefined;
    console.error(`[test-http-diagnostic] ${JSON.stringify({
      suite,
      operation,
      expectedStatus,
      actualStatus: response.status,
      contentType: response.headers['content-type'] ?? null,
      problem,
      sqlSnapshot: redact(state),
    })}`);
  }

  expect(response.status, `${suite}: ${operation}`).toBe(expectedStatus);
  return response;
}

function redact(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    return value
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
      .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\b/gi, '[redacted-id]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /(?:email|phone|token|secret|password|authorization|cookie|address|name|notes|message|content)/i.test(key)
        ? '[redacted]'
        : redact(item),
    ]));
  }
  return value;
}
