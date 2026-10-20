import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseHealthService } from './database-health.service.js';
import { validateEnvironment } from './config/environment.js';
import { HealthController } from './health.controller.js';
import { EventModule } from './events/event.module.js';
import { requestContextMiddleware } from './events/request-context.middleware.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';
import { EntitlementsModule } from './entitlements/entitlements.module.js';
import { ReferentialsModule } from './referentials/referentials.module.js';
import { CrmModule } from './crm/crm.module.js';
import { NetworkModule } from './network/network.module.js';
import { SalesModule } from './sales/sales.module.js';
import { PurchasesModule } from './purchases/purchases.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { CashModule } from './cash/cash.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { BillingModule } from './billing/billing.module.js';
import { IntelligenceModule } from './intelligence/intelligence.module.js';

@Module({
  imports: [
    EventModule,
    DatabaseModule,
    AuthModule,
    TenancyModule,
    EntitlementsModule,
    ReferentialsModule,
    CrmModule,
    NetworkModule,
    SalesModule,
    PurchasesModule,
    InventoryModule,
    ExpensesModule,
    CashModule,
    ProjectsModule,
    DocumentsModule,
    MessagingModule,
    BillingModule,
    IntelligenceModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
  ],
  controllers: [HealthController],
  providers: [DatabaseHealthService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestContextMiddleware).forRoutes('*');
  }
}
