import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseHealthService } from './database-health.service.js';
import { validateEnvironment } from './config/environment.js';
import { HealthController } from './health.controller.js';
import { EventModule } from './events/event.module.js';

@Module({
  imports: [
    EventModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
  ],
  controllers: [HealthController],
  providers: [DatabaseHealthService],
})
export class AppModule {}
