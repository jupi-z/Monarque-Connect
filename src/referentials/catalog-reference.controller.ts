import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CatalogReferenceService } from './catalog-reference.service.js';

@Controller('catalog')
@UseGuards(AuthGuard)
export class CatalogReferenceController {
  constructor(private readonly references: CatalogReferenceService) {}

  @Get('measure-units')
  listMeasureUnits(): Promise<unknown> { return this.references.listMeasureUnits(); }

  @Get('currencies')
  listCurrencies(): Promise<unknown> { return this.references.listCurrencies(); }
}
