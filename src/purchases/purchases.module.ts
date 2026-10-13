import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { SupplierRFQController } from './supplier-rfq.controller.js';
import { SupplierRFQService } from './supplier-rfq.service.js';
import { PurchaseOrderController } from './purchase-order.controller.js';
import { PurchaseOrderService } from './purchase-order.service.js';
import { GoodsReceiptController } from './goods-receipt.controller.js';
import { GoodsReceiptService } from './goods-receipt.service.js';

@Module({
  imports: [AuthModule, EntitlementsModule, EventModule, TenancyModule],
  controllers: [SupplierRFQController, PurchaseOrderController, GoodsReceiptController],
  providers: [SupplierRFQService, PurchaseOrderService, GoodsReceiptService],
})
export class PurchasesModule {}
