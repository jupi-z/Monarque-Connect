import { createHash } from 'node:crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class LoginRateLimiter {
  private readonly maxFailures = 5;
  private readonly windowMs = 15 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async assertAllowed(identifier: string, ipAddress: string): Promise<void> {
    const bucket = await this.prisma.loginRateLimitBucket.findUnique({ where: { keyHash: this.key(identifier, ipAddress) }, select: { blockedUntil: true } });
    if (bucket?.blockedUntil && bucket.blockedUntil > new Date()) throw new HttpException('Too many login attempts', HttpStatus.TOO_MANY_REQUESTS);
  }

  async recordFailure(identifier: string, ipAddress: string): Promise<void> {
    const keyHash = this.key(identifier, ipAddress);
    const now = new Date();
    const existing = await this.prisma.loginRateLimitBucket.findUnique({ where: { keyHash } });
    if (!existing || now.getTime() - existing.windowStarted.getTime() >= this.windowMs) {
      await this.prisma.loginRateLimitBucket.upsert({ where: { keyHash }, update: { failures: 1, blockedUntil: null, windowStarted: now }, create: { keyHash, failures: 1, windowStarted: now } });
      return;
    }
    const failures = existing.failures + 1;
    await this.prisma.loginRateLimitBucket.update({ where: { keyHash }, data: { failures, blockedUntil: failures >= this.maxFailures ? new Date(now.getTime() + this.windowMs) : null } });
  }

  async recordSuccess(identifier: string, ipAddress: string): Promise<void> {
    await this.prisma.loginRateLimitBucket.deleteMany({ where: { keyHash: this.key(identifier, ipAddress) } });
  }

  private key(identifier: string, ipAddress: string): string { return createHash('sha256').update(`${identifier.trim().toLowerCase()}:${ipAddress}`).digest('hex'); }
}
