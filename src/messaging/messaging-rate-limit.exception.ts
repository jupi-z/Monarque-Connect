import { HttpException, HttpStatus } from '@nestjs/common';

export class MessagingRateLimitException extends HttpException {
  constructor(public readonly retryAfterSeconds: number) {
    super('Messaging anti-abuse policy temporarily refused this command', HttpStatus.TOO_MANY_REQUESTS);
  }
}
