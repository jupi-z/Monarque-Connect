import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { PartyController } from './party.controller.js';
import { PartyService } from './party.service.js';
import { ItemController } from './item.controller.js';
import { ItemService } from './item.service.js';
import { WarehouseController } from './warehouse.controller.js';
import { WarehouseService } from './warehouse.service.js';
import { CatalogReferenceController } from './catalog-reference.controller.js';
import { CatalogReferenceService } from './catalog-reference.service.js';
import { CommercialCatalogController } from './commercial-catalog.controller.js';
import { CommercialCatalogService } from './commercial-catalog.service.js';

@Module({
  imports: [AuthModule, EventModule, TenancyModule],
  controllers: [PartyController, ItemController, WarehouseController, CatalogReferenceController, CommercialCatalogController],
  providers: [PartyService, ItemService, WarehouseService, CatalogReferenceService, CommercialCatalogService],
})
export class ReferentialsModule {}
