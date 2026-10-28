import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CatalogItemVariantParams, CommercialCatalogOrganizationParams, CommercialOfferListQuery, CommercialOfferParams, CreateCommercialOfferDto, CreateItemVariantDto, UpdateCommercialOfferDto } from './commercial-catalog.dto.js';
import { CommercialCatalogService } from './commercial-catalog.service.js';

@Controller('organizations/:organizationId/catalog')
@UseGuards(AuthGuard)
export class CommercialCatalogController {
  constructor(private readonly catalog: CommercialCatalogService) {}

  @Get('offers')
  listOffers(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: CommercialCatalogOrganizationParams, @Query() query: CommercialOfferListQuery): Promise<unknown> {
    return this.catalog.listOffers(principal, params.organizationId, query);
  }

  @Post('offers')
  createOffer(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: CommercialCatalogOrganizationParams, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateCommercialOfferDto): Promise<unknown> {
    return this.catalog.createOffer(principal, params.organizationId, input, key);
  }

  @Patch('offers/:offerId')
  updateOffer(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: CommercialOfferParams, @Headers('idempotency-key') key: string | undefined, @Body() input: UpdateCommercialOfferDto): Promise<unknown> {
    return this.catalog.updateOffer(principal, params.organizationId, params.offerId, input, key);
  }

  @Post('items/:itemId/variants')
  createVariant(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: CatalogItemVariantParams, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateItemVariantDto): Promise<unknown> {
    return this.catalog.createVariant(principal, params.organizationId, params.itemId, input, key);
  }
}
