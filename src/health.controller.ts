import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseHealthService } from './database-health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseHealthService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    try {
      await this.database.ping();
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        dependency: 'database',
      });
    }
  }
}
