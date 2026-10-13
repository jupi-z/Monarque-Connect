import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { QuoteController } from './quote.controller.js';
import { QuoteService } from './quote.service.js';
import { OrderController } from './order.controller.js';
import { OrderService } from './order.service.js';
import { InvoiceController } from './invoice.controller.js';
import { InvoiceService } from './invoice.service.js';

@Module({
  imports: [AuthModule, EventModule, EntitlementsModule, TenancyModule],
  controllers: [QuoteController, OrderController, InvoiceController],
  providers: [QuoteService, OrderService, InvoiceService],
})
export class SalesModule {}
